/* Small interaction layer for the monochrome controls and glass navigation. */
(function (window, document) {
  'use strict';

  const viewIds = ['explore', 'saved', 'write'];
  const find = selector => document.querySelector(selector);
  const nextFrame = callback => window.requestAnimationFrame
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(callback, 0);
  let navigationPending = false;
  let mapResizePending = false;

  function icon(name) {
    return typeof name === 'string' && /^[a-z0-9-]+$/.test(name)
      ? `<i data-lucide="${name}" aria-hidden="true"></i>`
      : '';
  }

  function refreshIcons() {
    if (typeof window.lucide?.createIcons === 'function') {
      window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
    }
  }

  function controls() {
    return viewIds.map(id => find(`#${id}`)).filter(Boolean);
  }

  function syncNavigation() {
    const nav = find('#main-tabs');
    if (!nav) return;

    // The editor is a temporary action; it must not overwrite the underlying view.
    if (!['explore', 'saved'].includes(nav.dataset.view)) {
      nav.dataset.view = find('#saved')?.getAttribute('aria-pressed') === 'true'
        ? 'saved'
        : 'explore';
    }
    const activeId = find('#editor')?.open ? 'write' : nav.dataset.view;
    nav.dataset.active = activeId;
    controls().forEach(button => {
      const active = button.id === activeId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const active = find(`#${activeId}`);
    if (!active || !active.offsetWidth || !active.offsetHeight) return;
    nav.style.setProperty('--tab-x', `${active.offsetLeft}px`);
    nav.style.setProperty('--tab-y', `${active.offsetTop}px`);
    nav.style.setProperty('--tab-w', `${active.offsetWidth}px`);
    nav.style.setProperty('--tab-h', `${active.offsetHeight}px`);
  }

  function scheduleNavigation() {
    if (navigationPending) return;
    navigationPending = true;
    nextFrame(() => {
      navigationPending = false;
      syncNavigation();
    });
  }

  function focusNavigation(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const button = event.target.closest('button');
    const available = controls().filter(control => !control.disabled);
    const index = available.indexOf(button);
    if (index < 0) return;

    let next = index;
    if (event.key === 'ArrowLeft') next = (index - 1 + available.length) % available.length;
    if (event.key === 'ArrowRight') next = (index + 1) % available.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = available.length - 1;
    event.preventDefault();
    available[next].focus({ preventScroll: true });
  }

  function updateMobileToggle() {
    const button = find('#mobile-map-toggle');
    if (!button) return;
    const list = document.body.dataset.mobileView === 'list';
    const text = list ? '查看地图' : '查看列表';
    button.setAttribute('aria-pressed', String(list));
    button.setAttribute('aria-label', text);
    button.innerHTML = `${icon(list ? 'map' : 'list')}<span data-mobile-label>${text}</span>`;
    refreshIcons();
  }

  function scheduleMapResize() {
    if (mapResizePending) return;
    mapResizePending = true;
    nextFrame(() => {
      mapResizePending = false;
      window.dispatchEvent(new window.Event('resize'));
    });
  }

  function setMobileView(view) {
    if (document.body.dataset.mobileView === view) return;
    document.body.dataset.mobileView = view;
    updateMobileToggle();
    scheduleMapResize();
  }

  function handleNavigationClick(event) {
    const button = event.target.closest('button');
    const mobile = typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 700px)').matches;
    if (mobile && button?.id === 'saved') setMobileView('list');
    if (mobile && button?.id === 'explore') setMobileView('map');
    scheduleNavigation();
  }

  function setup() {
    const nav = find('#main-tabs');
    if (nav) {
      nav.addEventListener('click', handleNavigationClick);
      nav.addEventListener('keydown', focusNavigation);
      if (typeof window.ResizeObserver === 'function') {
        const observer = new window.ResizeObserver(scheduleNavigation);
        observer.observe(nav);
        controls().forEach(button => observer.observe(button));
      }
    }
    const editor = find('#editor');
    if (editor) {
      editor.addEventListener('close', scheduleNavigation);
      editor.addEventListener('cancel', scheduleNavigation);
    }
    window.addEventListener('resize', scheduleNavigation);
    document.fonts?.ready?.then(scheduleNavigation).catch(() => {});

    const backup = find('#backup-dialog');
    find('#backup-open')?.addEventListener('click', () => {
      if (backup && !backup.open) backup.showModal();
    });

    if (!['map', 'list'].includes(document.body.dataset.mobileView)) {
      document.body.dataset.mobileView = 'map';
    }
    find('#mobile-map-toggle')?.addEventListener('click', () => {
      setMobileView(document.body.dataset.mobileView === 'list'
        ? 'map'
        : 'list');
    });
    updateMobileToggle();
    refreshIcons();
    syncNavigation();
  }

  window.TravelUI = { icon, refreshIcons, syncNavigation };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup, { once: true });
  } else {
    setup();
  }
})(window, document);
