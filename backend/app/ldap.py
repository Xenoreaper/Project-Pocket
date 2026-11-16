"""
Login against an LDAP directory.

LDAP is a protocol for directories of users. Checking a password works by
"binding": opening a connection as that user. This module does it in the usual
two steps:

1. bind as a service account (or anonymously) and search for the entry that
   belongs to the login name, to learn its distinguished name (DN);
2. bind again as that DN with the password the user typed.

Unlike Keycloak, the password passes through the backend here. It is used for
the bind only: never stored, never logged.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends
from ldap3 import NONE, Connection, Server
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars

from app.config import Settings, get_settings

# Search results that mean "the search itself worked". The size limit is reached
# when a filter matches more than the two entries we ask for.
_SEARCH_OUTCOMES = {"success", "sizeLimitExceeded"}

# Characters with a special meaning in LDAP search filters. No real login name
# contains them, so a name with one is rejected before it reaches the server.
# Escaping alone is not enough: some servers (GLAuth, found by the integration
# test) still read an escaped "*" as a wildcard.
_FILTER_CHARACTERS = frozenset("*()\\\0")


class InvalidLdapCredentialsError(Exception):
    """The user is unknown, ambiguous, or the password is wrong."""


class LdapUnavailableError(Exception):
    """The LDAP server could not be asked, so the login cannot be judged."""


@dataclass(frozen=True)
class LdapIdentity:
    """The verified facts about an LDAP user that the backend needs."""

    subject: str
    display_name: str


class LdapAuthenticator:
    """
    Check a login name and password against one LDAP directory.

    Args:
        connection_factory: opens a new, unbound connection. Production connects
            to the configured server; tests pass ldap3's offline mock server.
        bind_dn: service account for the search; empty for an anonymous search.
        bind_password: password of the service account.
        user_base_dn: subtree that contains the users.
        user_filter: search filter with a `{username}` placeholder.
        id_attribute: attribute whose value identifies the user permanently.
        display_name_attribute: attribute shown as the user's name.
    """

    def __init__(
        self,
        connection_factory: Callable[[], Connection],
        *,
        bind_dn: str,
        bind_password: str,
        user_base_dn: str,
        user_filter: str,
        id_attribute: str,
        display_name_attribute: str,
    ) -> None:
        self._connection_factory = connection_factory
        self._bind_dn = bind_dn
        self._bind_password = bind_password
        self._user_base_dn = user_base_dn
        self._user_filter = user_filter
        self._id_attribute = id_attribute
        self._display_name_attribute = display_name_attribute

    def authenticate(self, username: str, password: str) -> LdapIdentity:
        """
        Verify a login and return who it belongs to.

        Args:
            username: the login name the user typed.
            password: the password the user typed.

        Returns:
            The identity of the authenticated user.

        Raises:
            InvalidLdapCredentialsError: the login must be rejected.
            LdapUnavailableError: the server could not be reached or misbehaved.
        """
        # An empty password must never reach the server: LDAP treats a bind with
        # a DN and no password as an anonymous bind, and that "succeeds".
        if not username.strip() or not password:
            raise InvalidLdapCredentialsError("Missing username or password.")
        if _FILTER_CHARACTERS.intersection(username):
            raise InvalidLdapCredentialsError("The username contains filter characters.")

        try:
            connection = self._connection_factory()
            try:
                return self._search_and_bind(connection, username, password)
            finally:
                # Always close the connection, also after a failed login.
                connection.unbind()
        except LDAPException as error:
            raise LdapUnavailableError("The LDAP server could not be queried.") from error

    def _search_and_bind(
        self, connection: Connection, username: str, password: str
    ) -> LdapIdentity:
        """Run the two steps on an open connection (see the module docstring)."""
        if not connection.rebind(user=self._bind_dn or None, password=self._bind_password or None):
            # The service account itself was rejected: a configuration problem,
            # not the user's fault.
            raise LdapUnavailableError("The LDAP service account was rejected.")

        # Escaping turns characters such as * ( ) into harmless text. Without it,
        # a login name like "*" would match every user (LDAP injection). It is
        # the second line of defence after `_FILTER_CHARACTERS` above.
        search_filter = self._user_filter.replace("{username}", escape_filter_chars(username))
        connection.search(
            search_base=self._user_base_dn,
            search_filter=search_filter,
            attributes=[self._id_attribute, self._display_name_attribute],
            # Two is enough to notice an ambiguous filter without loading more.
            size_limit=2,
        )
        # "success" also covers "nothing found". Anything else (no permission to
        # search, wrong base DN) is a setup problem: reporting it as a wrong
        # password would hide it.
        outcome = connection.result.get("description")
        if outcome not in _SEARCH_OUTCOMES:
            raise LdapUnavailableError(f"The LDAP search failed: {outcome}.")
        if len(connection.entries) != 1:
            raise InvalidLdapCredentialsError("No single matching user.")

        entry = connection.entries[0]
        subject = _first_value(entry, self._id_attribute)
        if subject is None:
            raise LdapUnavailableError(
                f"LDAP entries have no '{self._id_attribute}' attribute; check the configuration."
            )

        # Step 2: the password is correct exactly if this bind succeeds.
        if not connection.rebind(user=entry.entry_dn, password=password):
            raise InvalidLdapCredentialsError("Wrong password.")

        display_name = _first_value(entry, self._display_name_attribute) or username
        return LdapIdentity(subject=subject, display_name=display_name)


def _first_value(entry: object, attribute: str) -> str | None:
    """
    Read one attribute of a search result as text.

    LDAP attributes can hold several values, or be missing. `entry[attribute]`
    raises for a missing attribute, so membership is checked first.
    """
    if attribute not in entry:  # type: ignore[operator]
        return None
    value = entry[attribute].value  # type: ignore[index]
    if isinstance(value, list):
        value = value[0] if value else None
    if value is None:
        return None
    # Binary identifiers such as objectGUID arrive as bytes; hex keeps them stable.
    return value.hex() if isinstance(value, bytes) else str(value)


def _open_connection(settings: Settings) -> Connection:
    """
    Open an unbound connection to the configured server.

    The timeouts stop a hanging LDAP server from blocking logins indefinitely.
    `raise_exceptions=False` makes a wrong password return False instead of
    raising, so only real failures arrive as exceptions.

    `get_info=NONE` and `read_server_info=False` stop ldap3 from reading the
    server's schema first. That read is anonymous; servers that forbid anonymous
    access close the connection on it, and we do not need the schema.
    """
    server = Server(settings.ldap_url, connect_timeout=5, get_info=NONE)
    connection = Connection(server, receive_timeout=5, raise_exceptions=False)
    connection.open(read_server_info=False)
    if settings.ldap_start_tls:
        connection.start_tls()
    return connection


def get_ldap_authenticator(
    settings: Annotated[Settings, Depends(get_settings)],
) -> LdapAuthenticator | None:
    """
    FastAPI dependency that provides the authenticator, or None if LDAP is off.

    Tests replace this function through `app.dependency_overrides`.
    """
    if not settings.ldap_enabled:
        return None
    return LdapAuthenticator(
        lambda: _open_connection(settings),
        bind_dn=settings.ldap_bind_dn,
        bind_password=settings.ldap_bind_password,
        user_base_dn=settings.ldap_user_base_dn,
        user_filter=settings.ldap_user_filter,
        id_attribute=settings.ldap_id_attribute,
        display_name_attribute=settings.ldap_display_name_attribute,
    )
