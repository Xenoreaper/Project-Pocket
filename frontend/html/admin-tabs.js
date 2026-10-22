(function () {
  function createAdminViewController(options = {}) {
    const views = options.views || {};
    const storageKey = String(options.storageKey || '');
    const defaultView = String(options.defaultView || 'users');

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
      if (!views[viewName]) return;

      const buttons = getViewButtons();
      buttons.forEach(button => button.classList.remove('active'));
      if (sourceBtn) sourceBtn.classList.add('active');

      Object.values(views).forEach(view => view?.classList.remove('active'));
      views[viewName]?.classList.add('active');
      persistView(viewName);
    }

    function getActiveViewName() {
      return document.querySelector('.nav-btn[data-view].active')?.dataset.view || defaultView;
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

    function bindNavigation() {
      const buttons = getViewButtons();
      buttons.forEach(button => {
        if (button.dataset.viewListenerAttached === 'true') return;

        button.addEventListener('click', async () => {
          const viewName = button.dataset.view;
          activateView(viewName, button);

          if (viewName === 'users') {
            await options.loadUsers?.();
            return;
          }

          if (viewName === 'analytics') {
            await options.loadAnalytics?.();
          }
        });

        button.dataset.viewListenerAttached = 'true';
      });
    }

    return {
      activateView,
      getActiveViewName,
      bindNavigation,
      hydrateFromStorage,
    };
  }

  window.ProjectPocketAdminTabs = {
    createAdminViewController,
  };
})();
