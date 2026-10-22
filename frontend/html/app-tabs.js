(function () {
  function createMainViewController(options = {}) {
    const views = options.views || {};
    const storageKey = String(options.storageKey || '');
    const defaultView = String(options.defaultView || 'all');

    function getViewButtons() {
      return Array.from(options.getViewButtons?.() || []);
    }

    function persistView(viewName) {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, String(viewName || ''));
      } catch {
        // Ignore storage failures.
      }
    }

    function getStoredViewName() {
      if (!storageKey) return '';
      try {
        const saved = String(localStorage.getItem(storageKey) || '').trim();
        return views[saved] ? saved : '';
      } catch {
        return '';
      }
    }

    function activateView(viewName, sourceBtn = null) {
      if (!viewName || !views[viewName]) return;

      const buttons = getViewButtons();
      buttons.forEach(button => button.classList.remove('active'));

      if (sourceBtn) {
        sourceBtn.classList.add('active');
      } else {
        buttons.find(button => button.dataset.view === viewName)?.classList.add('active');
      }

      Object.values(views).forEach(view => view?.classList.remove('active'));
      views[viewName]?.classList.add('active');
      persistView(viewName);

      options.onViewActivated?.(viewName);
    }

    function getActiveViewName() {
      return document.querySelector('.nav-btn[data-view].active')?.dataset.view || 'all';
    }

    function bindNavigation() {
      const buttons = getViewButtons();
      buttons.forEach(button => {
        if (button.dataset.viewListenerAttached === 'true') return;

        button.addEventListener('click', () => {
          const viewName = button.dataset.view;
          if (!viewName || !views[viewName]) return;

          if (!options.isAuthenticated?.()) {
            options.onUnauthorized?.();
            return;
          }

          activateView(viewName, button);
        });

        button.dataset.viewListenerAttached = 'true';
      });
    }

    function hydrateFromStorage() {
      const viewName = getStoredViewName() || (views[defaultView] ? defaultView : Object.keys(views)[0]);
      if (!viewName || !views[viewName]) return;

      const buttons = getViewButtons();
      buttons.forEach(button => {
        button.classList.toggle('active', button.dataset.view === viewName);
      });

      Object.values(views).forEach(view => view?.classList.remove('active'));
      views[viewName]?.classList.add('active');
    }

    return {
      activateView,
      getActiveViewName,
      bindNavigation,
      hydrateFromStorage,
    };
  }

  function createSharedTabsController(options = {}) {
    let listenersBound = false;
    const storageKey = String(options.storageKey || '');
    const defaultTab = String(options.defaultTab || 'received');

    function persistTab(tabName) {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, String(tabName || ''));
      } catch {
        // Ignore storage failures.
      }
    }

    function getStoredTabName() {
      if (!storageKey) return '';
      try {
        const saved = String(localStorage.getItem(storageKey) || '').trim();
        return ['sent', 'received', 'requests'].includes(saved) ? saved : '';
      } catch {
        return '';
      }
    }

    async function switchSharedTab(tabName) {
      if (!['sent', 'received', 'requests'].includes(tabName)) return;

      document.querySelectorAll('#shared-tabs .filter-tab').forEach(button => {
        button.classList.remove('active');
      });
      document.querySelector(`#shared-tabs .filter-tab[data-shared-tab="${tabName}"]`)?.classList.add('active');

      document.querySelectorAll('.shared-tab-content').forEach(panel => {
        panel.classList.remove('active');
      });

      if (tabName === 'sent') {
        document.getElementById('sent-shares-panel')?.classList.add('active');
        await options.loadSent?.();
        return;
      }

      if (tabName === 'received') {
        document.getElementById('received-shares-panel')?.classList.add('active');
        await options.loadReceived?.();
        return;
      }

      if (tabName === 'requests') {
        document.getElementById('requests-shares-panel')?.classList.add('active');
        await options.loadRequests?.();
      }

      persistTab(tabName);
    }

    async function loadShared() {
      if (!listenersBound) {
        document.querySelectorAll('#shared-tabs .filter-tab').forEach(button => {
          button.addEventListener('click', async () => {
            const tabName = button.dataset.sharedTab;
            await switchSharedTab(tabName);
          });
        });
        listenersBound = true;
      }

      const tabName = getStoredTabName() || defaultTab;
      await switchSharedTab(tabName);
    }

    return {
      switchSharedTab,
      loadShared,
    };
  }

  window.ProjectPocketTabs = {
    createMainViewController,
    createSharedTabsController,
  };
})();
