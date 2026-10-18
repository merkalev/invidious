'use strict';
/*
 * Material ripple feedback for interactive controls.
 *
 * Adds a short wave animation on pointer down. Delegated at the document
 * level so it also covers dynamically rendered buttons (subscriptions,
 * comments, playlists, …), without touching component code.
 */

(function () {
    function addRipple(host, event) {
        var rect = host.getBoundingClientRect();
        var size = Math.max(rect.width, rect.height) * 2;
        var x = event.clientX - rect.left - size / 2;
        var y = event.clientY - rect.top - size / 2;

        var ripple = document.createElement('span');
        ripple.className = 'md-ripple';
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        ripple.addEventListener('animationend', function () {
            ripple.remove();
        });
        host.appendChild(ripple);
    }

    document.addEventListener('pointerdown', function (event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var host = target.closest(
            'button.pure-button, a.pure-button, input.pure-button, #navbar button, #navbar .pure-menu-heading, .feed-menu-item, .watch-details summary, #filters-collapse summary, .md-action-tile, .channel-tab, .channel-sort-chip, .md-chip-link'
        );
        if (!host) return;

        host.classList.add('md-ripple-host');
        addRipple(host, event);
    }, { passive: true });
})();
