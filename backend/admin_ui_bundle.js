const ADMIN_USERS_VIEW_ID = "view-users";

function ensureUsersView() {
  let view = document.getElementById(ADMIN_USERS_VIEW_ID);
  if (view) {
    return {
      view,
      grid: document.getElementById("users-grid"),
      status: document.getElementById("users-load-status"),
    };
  }

  const main = document.querySelector("main");
  if (!main) {
    throw new Error("Main container not found");
  }

  view = document.createElement("section");
  view.id = ADMIN_USERS_VIEW_ID;
  view.className = "view";
  view.innerHTML = [
    "<h2>User Management</h2>",
    "<div id=\"users-grid\" class=\"users-grid\"></div>",
    "<p id=\"users-load-status\" class=\"list-load-status\" aria-live=\"polite\"></p>",
  ].join("");

  main.appendChild(view);
  return {
    view,
    grid: document.getElementById("users-grid"),
    status: document.getElementById("users-load-status"),
  };
}

function ensureUsersNavButton(core, onOpenUsers) {
  const navBar = document.querySelector("nav");
  if (!navBar) return null;

  let usersBtn = document.getElementById("users-nav-btn");
  if (!usersBtn) {
    usersBtn = document.createElement("button");
    usersBtn.id = "users-nav-btn";
    usersBtn.className = "nav-btn";
    usersBtn.dataset.view = "users";
    usersBtn.textContent = "Users";
    navBar.appendChild(usersBtn);
  }

  usersBtn.addEventListener("click", () => {
    core.activateView("users", usersBtn);
    void onOpenUsers();
  });

  return usersBtn;
}

function ensureAdminSettingsSection(settingsOverlay, onOpenUsers) {
  if (!settingsOverlay) return null;

  const settingsModal = settingsOverlay.querySelector(".settings-modal");
  if (!settingsModal) return null;

  let section = settingsModal.querySelector("#admin-section");
  if (!section) {
    section = document.createElement("div");
    section.id = "admin-section";
    section.className = "settings-section";
    section.innerHTML = [
      "<h4>Admin Controls</h4>",
      "<p class=\"settings-hint\">Admin-only tools are loaded dynamically.</p>",
      "<div class=\"settings-actions\">",
      "  <button id=\"admin-users-btn\" class=\"btn-toggle\" type=\"button\">Manage Users</button>",
      "</div>",
    ].join("");

    const dataBackupSection = Array.from(settingsModal.querySelectorAll(".settings-section")).find(sec => {
      const title = sec.querySelector("h4");
      return title && title.textContent && title.textContent.includes("Data Backup");
    });

    if (dataBackupSection) {
      settingsModal.insertBefore(section, dataBackupSection);
    } else {
      settingsModal.appendChild(section);
    }
  }

  const adminUsersBtn = section.querySelector("#admin-users-btn");
  if (adminUsersBtn) {
    adminUsersBtn.addEventListener("click", () => {
      settingsOverlay.classList.add("hidden");
      void onOpenUsers();
    });
  }

  return section;
}

function renderUsers(core, users, usersGrid, usersLoadStatus) {
  if (!usersGrid) return;

  if (!Array.isArray(users) || users.length === 0) {
    usersGrid.innerHTML = '<p class="settings-hint">No users found</p>';
    return;
  }

  const currentUsername = String(core.getAuthUsername?.() || "").toLowerCase();
  usersGrid.innerHTML = users
    .map(user => {
      const username = String(user.username || "");
      const isCurrentUser = username.toLowerCase() === currentUsername;
      const adminBadge = user.is_admin ? " (Admin)" : "";
      const createdDate = user.created_at ? new Date(user.created_at).toLocaleDateString() : "-";

      return [
        `<div class="user-item" data-username="${core.escHtml(username)}">`,
        "  <div class=\"user-info\">",
        `    <span class="user-name">${core.escHtml(username)}${adminBadge}</span>`,
        `    <span class="user-created">Created ${createdDate}</span>`,
        "  </div>",
        "  <div class=\"user-actions\">",
        isCurrentUser
          ? "<span class=\"user-action-placeholder\">Current user</span>"
          : `<button class="user-delete-btn btn-danger" type="button" data-username="${core.escHtml(username)}">Delete</button>`,
        "  </div>",
        "</div>",
      ].join("");
    })
    .join("");

  usersGrid.querySelectorAll(".user-delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const username = btn.dataset.username;
      if (!username) return;

      if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) {
        return;
      }

      btn.disabled = true;
      btn.textContent = "Deleting...";
      try {
        await core.apiFetch(`/users/${encodeURIComponent(username)}`, { method: "DELETE" });
        const row = usersGrid.querySelector(`[data-username="${CSS.escape(username)}"]`);
        row?.remove();
      } catch (err) {
        if (usersLoadStatus) {
          usersLoadStatus.textContent = `Failed to delete user: ${err.message || "Unknown error"}`;
        }
        btn.disabled = false;
        btn.textContent = "Delete";
      }
    });
  });
}

function createAdminController(core) {
  const usersElements = ensureUsersView();
  core.registerView?.("users", usersElements.view);

  const loadUsers = async () => {
    if (usersElements.status) usersElements.status.textContent = "Loading users...";

    try {
      const users = await core.apiFetch("/users");
      renderUsers(core, users, usersElements.grid, usersElements.status);
      if (usersElements.status) usersElements.status.textContent = "";
    } catch (err) {
      if (usersElements.status) {
        usersElements.status.textContent = `Failed to load users: ${err.message || "Unknown error"}`;
      }
    }
  };

  const openUsersView = async () => {
    const usersBtn = document.getElementById("users-nav-btn");
    core.activateView("users", usersBtn || null);
    await loadUsers();
  };

  const navButton = ensureUsersNavButton(core, openUsersView);
  const adminSection = ensureAdminSettingsSection(core.settingsOverlay, openUsersView);

  return {
    loadUsers,
    teardown() {
      navButton?.remove();
      adminSection?.remove();
      usersElements.view?.remove();
      if (core.views?.users) {
        delete core.views.users;
      }
    },
  };
}

if (!window.ProjectPocketAdmin) {
  window.ProjectPocketAdmin = {
    loaded: false,
    _controller: null,
    init(core) {
      if (this.loaded) return;
      this._controller = createAdminController(core);
      this.loaded = true;
    },
    teardown() {
      this._controller?.teardown?.();
      this._controller = null;
      this.loaded = false;
    },
  };
}

export {};
