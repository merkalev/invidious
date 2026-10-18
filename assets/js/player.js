'use strict';
/*
 * Video.js 10 integration.
 *
 * The player itself is rendered by static custom-element markup
 * (see src/invidious/views/components/player.ecr):
 *
 *   <video-player>          — state boundary, registered by /videojs/html/video.js
 *     <video-skin>          — the packaged default skin (controls, menus, …)
 *       <video|dash-video|hlsjs-video id="player"> — the media component
 *
 * This script only wires up the behaviours that live outside the skin:
 * prefetch preferences, saved position, captions, keyboard shortcuts and
 * the pointer helpers that other scripts (watch.js, embed.js, handlers.js)
 * call through the global `player`, which now refers to the underlying
 * media element (a real HTMLMediaElement, or a Video.js element that
 * wraps one).
 */
var player_data = JSON.parse(document.getElementById('player_data').textContent);
var video_data = JSON.parse(document.getElementById('video_data').textContent);
var CONFIG = JSON.parse(document.getElementById('config').textContent);

var player = document.getElementById('player');

/* The media element doubles as `window.player` for compatibility with the
 * rest of the scripts on the page. */
window.player = player;

var is_live = !!player_data.hls_url;
var is_dash = !!player_data.dash_url;
var is_native = !(is_live || is_dash);

var embed_url = new URL(location);
embed_url.searchParams.delete('v');
var short_url = location.origin + '/' + video_data.id + embed_url.search;
embed_url = location.origin + '/embed/' + video_data.id + embed_url.search;

var save_player_pos_key = 'save_player_pos';

/**
 * Runs the callback once the Video.js custom elements are defined.
 * On pages that use a plain <video>, it runs immediately.
 */
function whenPlayerReady(cb) {
    if (!('customElements' in window)) return;
    var elements = ['video-player', 'video-skin'];
    if (is_dash) elements.push('dash-video');
    if (is_live) elements.push('hlsjs-video');
    Promise.all(elements.map(function (name) { return customElements.whenDefined(name); }))
        .then(cb, function () {});
}

/* Graceful degradation: if the module bundles (and therefore the skin)
 * never load — e.g. blocked or unsupported browser — fall back to the
 * browser's native controls. */
if ((is_dash || is_live) && 'customElements' in window) {
    setTimeout(function () {
        if (!player.matches(':defined')) {
            var host = player.closest('video-player');
            if (!host || !host.matches(':defined')) {
                player.controls = true;
                if (video_data.params.autoplay) player.play().catch(function () {});
            }
        }
    }, 8000);
}

/* Network error recovery for plain <video> sources: once, retry with the
 * proxied (local=true) copy, preserving position, rate and pause state.
 * (Video.js 8 did this through reloadSourceOnError for the DASH path.) */
player.addEventListener('error', function () {
    if (is_dash || is_live || video_data.local_disabled) return;
    var err = player.error;
    if (!err) return;
    var code = err.code;
    if (code !== MediaError.MEDIA_ERR_NETWORK && code !== MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return;

    var sources = player.getElementsByTagName('source');
    var current = player.currentSrc || '';
    if (current.includes('local=true') || sources.length === 0) return;

    var retry = false;
    Array.prototype.forEach.call(sources, function (source) {
        if (!source.src.includes('local=true')) {
            source.src += (source.src.includes('?') ? '&' : '?') + 'local=true';
            retry = true;
        }
    });

    if (!retry) return;

    setTimeout(function () {
        var currentTime = player.currentTime;
        var playbackRate = player.playbackRate;
        var paused = player.paused;
        player.load();
        player.currentTime = currentTime;
        player.playbackRate = playbackRate;
        if (!paused) player.play();
    }, 5000);
});

/* Volume & speed */
function applyDefaultVolumeAndRate() {
    /* Remove any own properties set before custom-element upgrade so
     * DashVideoElement / HlsJsVideoElement prototype getters/setters work. */
    delete player.volume;
    delete player.playbackRate;
    delete player.muted;
    var volume = (video_data.params.volume / 100);
    if (volume >= 0 && volume <= 1) player.volume = volume;
    if (video_data.params.speed > 0) player.playbackRate = video_data.params.speed;
}

/* Feed the structured `source` to the media components. The attribute in
 * markup only carries the URL; the type must be set through the property,
 * since proxy URLs have no file extension for the engine to infer from. */
whenPlayerReady(function () {
    /* Ensure CustomMediaElement registers its shadow-<video> event forwarders
     * for all media events attached before or after custom element upgrade. */
    var noop = function () {};
    [
        'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough',
        'playing', 'play', 'pause', 'ended', 'timeupdate',
        'ratechange', 'volumechange', 'error', 'waiting', 'seeking', 'seeked'
    ].forEach(function (ev) {
        player.addEventListener(ev, noop);
        player.removeEventListener(ev, noop);
    });

    applyDefaultVolumeAndRate();

    if (is_dash || is_live) {
        var sourceConfig = {
            src: is_dash ? player_data.dash_url : player_data.hls_url,
            type: is_dash ? 'application/dash+xml' : 'application/vnd.apple.mpegurl',
        };
        if (is_dash) {
            sourceConfig.engine = {
                dashJs: {
                    streaming: {
                        buffer: {
                            fastSwitchEnabled: true
                        }
                    }
                }
            };
        }
        player.source = sourceConfig;

        /* Fallback to progressive <video> stream if DASH manifest fails to load/parse */
        if (is_dash && player.engine && typeof player.engine.on === 'function' &&
            player_data.fallback_sources && player_data.fallback_sources.length > 0) {
            var dashFallbackTriggered = false;
            player.engine.on('error', function (e) {
                if (dashFallbackTriggered) return;
                var errCode = e && e.error && e.error.code;
                /* 25 = MANIFEST_LOADER_PARSING_FAILURE, 27 = MANIFEST_LOADER_LOADING_FAILURE */
                if (errCode === 25 || errCode === 27 || (e && e.error === 'download' && e.event && e.event.id === 'manifest')) {
                    dashFallbackTriggered = true;
                    try {
                        var innerVideo = player.target || (player.shadowRoot && player.shadowRoot.querySelector('video'));
                        if (innerVideo) {
                            player.engine.reset();
                            innerVideo.src = player_data.fallback_sources[0].src;
                            innerVideo.load();
                            if (video_data.params.autoplay) innerVideo.play().catch(function () {});
                        }
                    } catch (err) { /* noop */ }
                }
            });
        }

        /* The source was assigned after parsing, so the autoplay attribute
         * alone may not fire — request playback explicitly. */
        if (video_data.params.autoplay && player.play) {
            var promise = player.play();
            if (promise && promise.catch) promise.catch(function () {});
        }
    }
});

/* Pin a preferred quality (effective_quality_dash / params.quality_dash:
 * 'auto' | 'best' | 'worst' | <height>) once the engine reports renditions,
 * and mount a quick-access quality badge on the Video.js 10 control bar. */
var targetDashQuality = player_data.effective_quality_dash || video_data.params.quality_dash;
if ((is_dash || is_live) && !video_data.params.listen) {
    whenPlayerReady(function () {
        var host = document.querySelector('video-player');
        var skin = document.querySelector('video-skin');

        /* Create a visible Quality pill button in the Video.js 10 control bar
         * that displays the active resolution (e.g. "1080p", "Auto · 720p")
         * and opens the Video.js 10 Quality menu when clicked. */
        var qualityBtn = null;
        var qualityBtnLabel = null;
        if (skin && skin.shadowRoot) {
            var settingsBtn = skin.shadowRoot.querySelector('.video-controls-settings-button');
            var qualityRadioGroup = skin.shadowRoot.querySelector('media-quality-radio-group');
            var qualityMenuContent = qualityRadioGroup ? qualityRadioGroup.closest('media-menu-content') : null;
            var qualitySubmenuTrigger = qualityMenuContent && qualityMenuContent.id
                ? skin.shadowRoot.querySelector('media-menu-item[commandfor="' + qualityMenuContent.id + '"]')
                : null;

            if (settingsBtn && settingsBtn.parentNode) {
                qualityBtn = document.createElement('button');
                qualityBtn.type = 'button';
                qualityBtn.className = 'media-button iv-quality-control-btn';
                qualityBtn.title = 'Video Quality';
                qualityBtn.setAttribute('aria-label', 'Video Quality');
                qualityBtn.style.cssText = 'width:auto;padding:0 10px;font-size:12px;font-weight:600;letter-spacing:0.02em;display:none;align-items:center;gap:4px;white-space:nowrap;';
                qualityBtnLabel = document.createElement('span');
                qualityBtnLabel.textContent = 'HD';
                qualityBtn.appendChild(qualityBtnLabel);
                settingsBtn.parentNode.insertBefore(qualityBtn, settingsBtn);

                qualityBtn.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    settingsBtn.click();
                    if (qualitySubmenuTrigger) {
                        setTimeout(function () {
                            var menuPopup = qualitySubmenuTrigger.closest('media-menu');
                            if (menuPopup && menuPopup.hasAttribute('data-open')) {
                                qualitySubmenuTrigger.click();
                            }
                        }, 40);
                    }
                });
            }
        }

        function updateQualityBadge() {
            if (!qualityBtn || !qualityBtnLabel || !player.videoRenditions) return;
            var renditions = Array.from(player.videoRenditions);
            if (renditions.length === 0) {
                qualityBtn.style.display = 'none';
                return;
            }
            qualityBtn.style.display = 'inline-flex';
            var selected = renditions.find(function (r) { return r.selected; });
            var active = renditions.find(function (r) { return r.active; }) || selected;
            var height = active && active.height ? active.height + 'p' : '';
            if (selected && selected.height) {
                qualityBtnLabel.textContent = selected.height + 'p';
            } else if (height) {
                qualityBtnLabel.textContent = 'Auto (' + height + ')';
            } else {
                qualityBtnLabel.textContent = 'Auto';
            }
        }

        if (player.videoRenditions && typeof player.videoRenditions.addEventListener === 'function') {
            player.videoRenditions.addEventListener('change', function () {
                updateQualityBadge();
                /* Persist manual quality selection in PREFS cookie */
                if (!initialPickInProgress) {
                    var renditions = Array.from(player.videoRenditions);
                    var selected = renditions.find(function (r) { return r.selected; });
                    var newQualityDash = (selected && selected.height) ? (selected.height + 'p') : 'auto';
                    updateCookie(null, null, newQualityDash);
                }
            });
        }
        if (player.videoTracks && typeof player.videoTracks.addEventListener === 'function') {
            player.videoTracks.addEventListener('addtrack', updateQualityBadge);
            player.videoTracks.addEventListener('change', updateQualityBadge);
        }
        var initialPickInProgress = false;
        var applied = false;

        function applyInitialQuality() {
            if (applied || !player.videoRenditions) return;
            /* Refresh Video.js 10 quality store after all rendition IDs are assigned */
            try {
                player.videoRenditions.dispatchEvent(new Event('activechange'));
            } catch (e) { /* noop */ }

            if (!targetDashQuality || targetDashQuality === 'auto') {
                applied = true;
                updateQualityBadge();
                return;
            }

            var rawList = Array.from(player.videoRenditions);
            if (rawList.length === 0) return;

            var indexed = rawList.map(function (r, idx) {
                var h = r.height || Math.round(Math.sqrt(r.width || 0) * 9 / 16) || 0;
                return { index: idx, height: h, bitrate: r.bitrate || 0, id: r.id };
            });
            indexed.sort(function (a, b) {
                return a.height - b.height || a.bitrate - b.bitrate;
            });

            var chosenIndex = -1;
            if (targetDashQuality === 'best') {
                chosenIndex = indexed[indexed.length - 1].index;
            } else if (targetDashQuality === 'worst') {
                chosenIndex = indexed[0].index;
            } else {
                var targetHeight = parseInt(targetDashQuality, 10);
                if (!targetHeight) return;
                indexed.forEach(function (item) {
                    if (item.height <= targetHeight) chosenIndex = item.index;
                });
                if (chosenIndex === -1) chosenIndex = indexed[0].index;
            }

            if (chosenIndex !== -1) {
                applied = true;
                initialPickInProgress = true;
                try {
                    player.videoRenditions.selectedIndex = chosenIndex;
                } catch (e) { /* noop */ }
                setTimeout(function () {
                    initialPickInProgress = false;
                    updateQualityBadge();
                }, 100);
            }
        }

        if (is_dash && player.engine && typeof player.engine.on === 'function') {
            player.engine.on('streamInitialized', function () {
                setTimeout(function () {
                    applyInitialQuality();
                    updateQualityBadge();
                }, 20);
            });
            player.engine.on('qualityChangeRendered', function () {
                setTimeout(updateQualityBadge, 50);
            });
        } else if (player.videoRenditions && typeof player.videoRenditions.addEventListener === 'function') {
            var addTimer = null;
            player.videoRenditions.addEventListener('addrendition', function () {
                if (applied) return;
                clearTimeout(addTimer);
                addTimer = setTimeout(applyInitialQuality, 50);
            });
        }
    });
}

/*
 * Captions
 * --------
 * Inject <track> elements directly on `player`. For streaming custom elements
 * (`<dash-video>`, `<hlsjs-video>`), Video.js 10's custom-media-element
 * automatically mirrors light-DOM `<track>` children into its shadow `<video>`
 * and exposes them via `player.textTracks`.
 */
if (player_data.captions.length > 0) {
    function injectCaptions() {
        player_data.captions.forEach(function (caption) {
            var track = document.createElement('track');
            track.kind = 'captions';
            track.label = caption.label;
            track.srclang = caption.language;
            track.src = caption.src;
            player.appendChild(track);
        });
        if (player_data.preferred_caption_found) {
            setTimeout(function () {
                if (!player.textTracks) return;
                for (var i = 0; i < player.textTracks.length; i++) {
                    if (player.textTracks[i].kind === 'captions') {
                        player.textTracks[i].mode = 'showing';
                        break;
                    }
                }
            }, 0);
        }
    }

    if (is_native) {
        injectCaptions();
    } else {
        whenPlayerReady(injectCaptions);
    }
}

/* Storyboard: preloads hover previews via a metadata track (child of the
 * media element, rendered server side). Errors are silently ignored. */

/*
 * Cookie persistence for volume, speed, and DASH quality.
 */
function getCookieValue(name) {
    var cookiePrefix = name + '=';
    var matchedCookie = document.cookie.split(';').find(function (item) {return item.includes(cookiePrefix);});
    if (matchedCookie)
        return matchedCookie.replace(cookiePrefix, '').trim();
    return null;
}

function updateCookie(newVolume, newSpeed, newQualityDash) {
    var volumeValue = newVolume !== null && newVolume !== undefined ? newVolume : video_data.params.volume;
    var speedValue = newSpeed !== null && newSpeed !== undefined ? newSpeed : video_data.params.speed;
    var qualityDashValue = newQualityDash !== null && newQualityDash !== undefined ? newQualityDash : video_data.params.quality_dash;

    var cookieValue = getCookieValue('PREFS');
    var cookieData;

    if (cookieValue !== null) {
        var cookieJson = JSON.parse(decodeURIComponent(cookieValue));
        cookieJson.volume = volumeValue;
        cookieJson.speed = speedValue;
        if (qualityDashValue) cookieJson.quality_dash = qualityDashValue;
        cookieData = encodeURIComponent(JSON.stringify(cookieJson));
    } else {
        var payload = { 'volume': volumeValue, 'speed': speedValue };
        if (qualityDashValue) payload.quality_dash = qualityDashValue;
        cookieData = encodeURIComponent(JSON.stringify(payload));
    }

    var date = new Date();
    date.setFullYear(date.getFullYear() + 2);

    var ipRegex = /^((\d+\.){3}\d+|[\dA-Fa-f]*:[\d:A-Fa-f]*:[\d:A-Fa-f]+)$/;
    var domainUsed = location.hostname;

    if (domainUsed.charAt(0) !== '.' && !ipRegex.test(domainUsed) && domainUsed !== 'localhost')
        domainUsed = '.' + location.hostname;

    var secure = location.protocol.startsWith("https") ? " Secure;" : "";

    document.cookie = 'PREFS=' + cookieData + '; SameSite=Lax; path=/; domain=' +
        domainUsed + '; expires=' + date.toGMTString() + ';' + secure;

    video_data.params.volume = volumeValue;
    video_data.params.speed = speedValue;
    if (qualityDashValue) video_data.params.quality_dash = qualityDashValue;
}

player.addEventListener('ratechange', function () {
    updateCookie(null, player.playbackRate);
});

player.addEventListener('volumechange', function () {
    updateCookie(Math.ceil(player.volume * 100), null);
});

/**
 * Function for adding the current timestamp to a URL
 */
function addCurrentTimeToURL(url, base, param = 't') {
    var urlUsed = new URL(url, base);
    urlUsed.searchParams.delete('start');
    var currentTime = Math.ceil(player.currentTime);
    if (currentTime > 0)
        urlUsed.searchParams.set(param, currentTime);
    else if (urlUsed.searchParams.has('t'))
        urlUsed.searchParams.delete('t');
    return urlUsed;
}

var timeupdate_last_ts = 5;

player.addEventListener('timeupdate', function () {
    // Only update once every second
    let current_ts = Math.floor(player.currentTime);
    if (current_ts != timeupdate_last_ts) timeupdate_last_ts = current_ts;
    else return;

    // YouTube links
    var elem_yt_watch = document.getElementById('link-yt-watch');
    if (elem_yt_watch) {
        let base_url_yt_watch = elem_yt_watch.getAttribute('data-base-url');
        elem_yt_watch.href = addCurrentTimeToURL(base_url_yt_watch);
    }

    let elem_yt_embed = document.getElementById('link-yt-embed');
    if (elem_yt_embed) {
        let base_url_yt_embed = elem_yt_embed.getAttribute('data-base-url');
        elem_yt_embed.href = addCurrentTimeToURL(base_url_yt_embed, undefined, 'start');
    }

    // Invidious links
    let domain = window.location.origin;

    let elem_iv_embed = document.getElementById('link-iv-embed');
    if (elem_iv_embed) {
        let base_url_iv_embed = elem_iv_embed.getAttribute('data-base-url');
        elem_iv_embed.href = addCurrentTimeToURL(base_url_iv_embed, domain);
    }

    let elem_iv_other = document.getElementById('link-iv-other');
    if (elem_iv_other) {
        let base_url_iv_other = elem_iv_other.getAttribute('data-base-url');
        elem_iv_other.href = addCurrentTimeToURL(base_url_iv_other, domain);
    }

    let elem_iv_listen = document.getElementById('link-iv-listen');
    if (elem_iv_listen) {
        let base_url_iv_listen = elem_iv_listen.getAttribute('data-base-url');
        elem_iv_listen.href = addCurrentTimeToURL(base_url_iv_listen, domain);
    }
});

/* Saved position (preferences › 'remember playback position') */
function get_all_video_times() {
    return helpers.storage.get(save_player_pos_key) || {};
}

function get_video_time() {
    return get_all_video_times()[video_data.id] || 0;
}

function save_video_time(seconds) {
    var all_video_times = get_all_video_times();
    all_video_times[video_data.id] = seconds;
    helpers.storage.set(save_player_pos_key, all_video_times);
}

function remove_all_video_times() {
    helpers.storage.remove(save_player_pos_key);
}

function set_seconds_after_start(delta) {
    player.currentTime = video_data.params.video_start + delta;
}

if (video_data.params.save_player_pos && typeof helpers !== 'undefined') {
    var url = new URL(location);
    var hasTimeParam = url.searchParams.has('t') || url.searchParams.has('start') || video_data.params.video_start > 0;
    var rememberedTime = get_video_time();
    var lastUpdated = 0;
    var positionRestored = false;

    /* Restored on first metadata load so it also applies to the streaming
     * engines, whose source is assigned through the custom element API. */
    player.addEventListener('loadedmetadata', function () {
        if (positionRestored || hasTimeParam || video_data.length_seconds <= 0) return;
        positionRestored = true;
        if (rememberedTime >= video_data.length_seconds - 20)
            player.currentTime = 0;
        else if (rememberedTime > 0)
            player.currentTime = rememberedTime;
    });

    player.addEventListener('timeupdate', function () {
        var raw = player.currentTime;
        var time = Math.floor(raw);

        if (lastUpdated !== time && raw <= video_data.length_seconds - 15) {
            save_video_time(time);
            lastUpdated = time;
        }
    });
} else if (typeof helpers !== 'undefined') {
    remove_all_video_times();
}

/* Start/end parameter support (t=, video_start/video_end) */
var startApplied = false;
player.addEventListener('loadedmetadata', function () {
    if (startApplied) return;
    startApplied = true;
    if (video_data.params.video_start > 0) {
        player.currentTime = video_data.params.video_start;
    }
});

player.addEventListener('timeupdate', function () {
    var end = video_data.params.video_end;
    if (end <= 0) return;
    if (player.currentTime < end) return;

    if (video_data.params.video_loop && params_start_defined()) {
        player.currentTime = video_data.params.video_start;
    } else {
        player.pause();
    }
});

function params_start_defined() {
    return video_data.params.video_start > 0;
}

/* Keyboard shortcuts (subset of the previous hotkey list; caption
 * styling hotkeys inherited from Video.js 8's textTrackSettings are gone) */
function change_volume(delta) {
    var newVolume = player.volume + delta;
    player.volume = Math.min(1, Math.max(0, newVolume));
}

function toggle_muted() {
    player.muted = !player.muted;
}

function skip_seconds(delta) {
    var newTime = player.currentTime + delta;
    if (player.duration >= 0) newTime = Math.min(player.duration, newTime);
    player.currentTime = Math.max(0, newTime);
}

function set_time_percent(percent) {
    if (player.duration >= 0) player.currentTime = player.duration * (percent / 100);
}

function play()  { player.play(); }
function pause() { player.pause(); }
function stop()  { player.pause(); player.currentTime = 0; }
function toggle_play() { player.paused ? play() : pause(); }

const toggle_captions = (function () {
    let toggledTrack = null;

    function bindChange(onOrOff) {
        if (player.textTracks && typeof player.textTracks[onOrOff] === 'function') {
            player.textTracks[onOrOff]('change', onTrackChange);
        }
    }

    function onTrackChange() {
        toggledTrack = null;
    }

    function setMode(track, mode) {
        bindChange('removeEventListener');
        track.mode = mode;
        setTimeout(function () {
            bindChange('addEventListener');
        }, 0);
    }

    bindChange('addEventListener');
    return function () {
        if (toggledTrack !== null) {
            if (toggledTrack.mode !== 'showing') {
                setMode(toggledTrack, 'showing');
            } else {
                setMode(toggledTrack, 'disabled');
            }
            toggledTrack = null;
            return;
        }

        let fallbackCaptionsTrack = null;
        const tracks = player.textTracks || [];
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            if (track.kind !== 'captions') continue;

            if (fallbackCaptionsTrack === null) fallbackCaptionsTrack = track;
            if (track.mode === 'showing') {
                setMode(track, 'disabled');
                toggledTrack = track;
                return;
            }
        }

        if (fallbackCaptionsTrack !== null) {
            setMode(fallbackCaptionsTrack, 'showing');
            toggledTrack = fallbackCaptionsTrack;
        }
    };
})();

function toggle_fullscreen() {
    var target = player.closest('video-skin') ||
                 document.getElementById('player-container') || player;
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else if (target.requestFullscreen) {
        target.requestFullscreen();
    }
}

var playbackRates = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
function increase_playback_rate(steps) {
    var maxIndex = playbackRates.length - 1;
    var curIndex = playbackRates.indexOf(player.playbackRate);
    if (curIndex === -1) curIndex = 3; // default to 1.0 index
    var newIndex = Math.min(maxIndex, Math.max(0, curIndex + steps));
    player.playbackRate = playbackRates[newIndex];
}

document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) return;

    var skin = player.closest('video-skin');
    const isPlayerFocused = e.target === player || player.contains(e.target) || (skin && (e.target === skin || skin.contains(e.target)));

    /* If focus is inside `<video-skin>`, let Video.js 10's `<media-hotkey>` handle
     * the standard player keys so it doesn't double-toggle with our listener. */
    const skinHandlesKey = isPlayerFocused && skin && skin.matches && skin.matches(':defined') && (
        e.key === ' ' || e.key === 'k' || e.key === 'm' ||
        e.key === 'ArrowRight' || e.key === 'ArrowLeft' ||
        e.key === 'l' || e.key === 'j' ||
        e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
        (e.key >= '0' && e.key <= '9') ||
        e.key === '>' || e.key === '<' ||
        e.key === 'f' || e.key === 'c'
    );
    if (skinHandlesKey) return;

    let action = null;
    const key = e.key;

    switch (key) {
        case ' ':
            if (tag === 'button' || tag === 'a' || tag === 'summary') break;
            action = toggle_play;
            break;
        case 'k':
        case 'MediaPlayPause':
            action = toggle_play;
            break;
        case 'MediaPlay':  action = play; break;
        case 'MediaPause': action = pause; break;
        case 'MediaStop':  action = stop; break;

        case 'ArrowUp':
            if (isPlayerFocused) action = change_volume.bind(this, 0.1);
            break;
        case 'ArrowDown':
            if (isPlayerFocused) action = change_volume.bind(this, -0.1);
            break;

        case 'm':
            action = toggle_muted;
            break;

        case 'ArrowRight':
        case 'MediaFastForward':
            action = skip_seconds.bind(this, 5 * player.playbackRate);
            break;
        case 'ArrowLeft':
        case 'MediaTrackPrevious':
            action = skip_seconds.bind(this, -5 * player.playbackRate);
            break;
        case 'l':
            action = skip_seconds.bind(this, 10 * player.playbackRate);
            break;
        case 'j':
            action = skip_seconds.bind(this, -10 * player.playbackRate);
            break;

        case '0': case '1': case '2': case '3': case '4':
        case '5': case '6': case '7': case '8': case '9':
            if (e.keyCode > 57) break; // ignore numpad
            action = set_time_percent.bind(this, (e.keyCode - 48) * 10);
            break;

        case 'c': action = toggle_captions; break;
        case 'f': action = toggle_fullscreen; break;

        case 'N':
        case 'MediaTrackNext':
            if (typeof next_video === 'function') action = next_video;
            break;

        case ',': action = function () { pause(); skip_seconds(-1/29.97); }; break;
        case '.': action = function () { pause(); skip_seconds( 1/29.97); }; break;

        case '>': action = increase_playback_rate.bind(this, 1); break;
        case '<': action = increase_playback_rate.bind(this, -1); break;

        default:
            break;
    }

    if (action) {
        e.preventDefault();
        action();
    }
}, false);

/* Volume control by scrolling over the player */
(function () {
    var skin = player.closest('video-skin') || document.getElementById('player-container') || player;
    skin.addEventListener('wheel', function (event) {
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.target && event.target.closest && event.target.closest('.media-menu-popup, [data-part=menu]')) return;
        event.preventDefault();
        var direction = Math.sign(event.deltaY || 0) * -1;
        change_volume(direction * 0.05);
    }, { passive: false });
})();

/* Safari: audio-only playback sometimes reports a doubled duration */
if (navigator.vendor === 'Apple Computer, Inc.' && video_data.params.listen) {
    player.addEventListener('loadedmetadata', function () {
        player.addEventListener('timeupdate', function () {
            var remaining = player.duration - player.currentTime;
            if (remaining < player.duration / 2 && remaining >= 2) {
                player.currentTime = player.duration - 1;
            }
        });
    });
}

/* Safari: screen stays awake even when a looped video is paused */
if (navigator.vendor === 'Apple Computer, Inc.' && !video_data.params.listen && video_data.params.video_loop) {
    player.loop = false;
    player.addEventListener('ended', function () {
        player.currentTime = 0;
        player.play();
    });
}

/* Save the timestamp when the link to another instance is used */
addEventListener('DOMContentLoaded', function () {
    // Save time during redirection on another instance
    const changeInstanceLink = document.querySelector('#watch-on-another-invidious-instance > a');
    if (changeInstanceLink) changeInstanceLink.addEventListener('click', function () {
        changeInstanceLink.href = addCurrentTimeToURL(changeInstanceLink.href);
    });
});
