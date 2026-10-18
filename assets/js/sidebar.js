'use strict';

/**
 * Modern YouTube-like left navigation rail.
 *
 * Behavior:
 *  - Desktop (width > 1024 px): the hamburger toggles an icon-only
 *    "mini" rail. The choice is remembered for the next page loads.
 *  - Mobile (width <= 1024 px): the rail is off-canvas; the hamburger
 *    opens it as a drawer (closed by tapping the dark scrim or the
 *    hamburger again).
 *  - The current page is visually highlighted in both cases.
 */
(function () {
    // null = nothing succeeded (no fatal break if the DOM changed)
    if (!document || !document.body) {
        return;
    }

    var KEY_RAIL = 'sidebar_rail_collapsed';

    document.addEventListener('DOMContentLoaded', function () {
        var toggleButton = document.getElementById('sidebar-toggle');
        var scrim = document.getElementById('sidebar-scrim');
        var sidebar = document.getElementById('sidebar');
        var railCollapsed = false;

        try {
            var stored = helpers.storage.get(KEY_RAIL);
            railCollapsed = (stored === true || stored === 'true');
        } catch (e) {
            railCollapsed = false;
        }

        if (railCollapsed && window.innerWidth > 1024) {
            document.body.classList.add('sidebar-rail-collapsed');
        }

        function toggleSidebar() {
            var smallScreen = window.innerWidth <= 1024;

            if (smallScreen) {
                document.body.classList.toggle('sidebar-drawer-open');
            } else {
                railCollapsed = !railCollapsed;
                document.body.classList.toggle('sidebar-rail-collapsed', railCollapsed);
                try {
                    helpers.storage.set(KEY_RAIL, railCollapsed);
                } catch (e) {
                    // ignore storage failures (private mode, etc.)
                }
            }
        }

        function closeDrawer() {
            document.body.classList.remove('sidebar-drawer-open');
        }

        if (toggleButton) {
            toggleButton.addEventListener('click', toggleSidebar);
        }
        if (scrim) {
            scrim.addEventListener('click', closeDrawer);
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closeDrawer();
            }
        });

        // Highlight the current page.
        if (sidebar) {
            var here = window.location.pathname;
            var prefix = '/';
            if (here !== '/') {
                prefix = here.startsWith('/feed/') ? here : '/' + (here.split('/')[1] || '');
            }

            sidebar.querySelectorAll('a').forEach(function (link) {
                var target = new URL(link.href, window.location.origin);
                if (target.pathname === prefix) {
                    link.classList.add('current');
                }
            });
        }

        // A resize while the drawer is open moves us to desktop layout:
        // close the drawer so the rail takes over smoothly.
        window.addEventListener('resize', function () {
            if (window.innerWidth > 1024) {
                closeDrawer();
            }
        });
    });
})();
