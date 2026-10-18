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
    var elements = ['video-player'];
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

/* Feed the structured `source` to the media components. The attribute in
 * markup only carries the URL; the type must be set through the property,
 * since proxy URLs have no file extension for the engine to infer from. */
whenPlayerReady(function () {
    if (is_dash || is_live) {
        player.source = {
            src: is_dash ? player_data.dash_url : player_data.hls_url,
            type: is_dash ? 'application/dash+xml' : 'application/vnd.apple.mpegurl',
        };
        /* The source was assigned after parsing, so the autoplay attribute
         * alone may not fire — request playback explicitly. */
        if (video_data.params.autoplay && player.play) {
            var promise = player.play();
            if (promise && promise.catch) promise.catch(function () {});
        }
    }
});

/* Pin a preferred quality (params.quality_dash: 'auto' | 'best' | 'worst' | <height>)
 * once the engine reports renditions. Best-effort: wrapped so a change in
 * the player store layout can never break playback. */
if (is_dash && video_data.params.quality_dash
    && video_data.params.quality_dash !== 'auto'
    && !video_data.params.listen) {
    whenPlayerReady(function () {
        var host = document.querySelector('video-player');
        if (!host || !host.store) return;
        var store = host.store;

        function findQualityState(state) {
            if (!state) return null;
            if (state.videoRenditionList && typeof state.selectVideoRendition === 'function') {
                return state;
            }
            var holder = state.quality || state.qualityData || null;
            if (holder && holder.videoRenditionList) return holder;
            for (var key in state) {
                var value = state[key];
                if (value && typeof value === 'object' && value.videoRenditionList)
                    return value;
            }
            return null;
        }

        function pickRendition(qualityState) {
            var list = (qualityState.videoRenditionList || []).slice();
            if (list.length === 0) return false;
            var wanted = video_data.params.quality_dash;
            list.sort(function (a, b) {
                var ha = a.height || Math.sqrt(a.width || 0) * 9 / 16;
                var hb = b.height || Math.sqrt(b.width || 0) * 9 / 16;
                return ha - hb || (a.bitrate || 0) - (b.bitrate || 0);
            });
            if (wanted === 'best') {
                qualityState.selectVideoRendition(list[list.length - 1].id);
                return true;
            } else if (wanted === 'worst') {
                qualityState.selectVideoRendition(list[0].id);
                return true;
            } else {
                var targetHeight = parseInt(wanted, 10);
                if (!targetHeight) return false;
                var best;
                list.forEach(function (rendition) {
                    var height = rendition.height || Math.sqrt(rendition.width || 0) * 9 / 16;
                    if (height <= targetHeight) best = rendition.id;
                });
                if (best === undefined) best = list[0].id;
                qualityState.selectVideoRendition(best);
                return true;
            }
        }

        var applied = false;
        var unsub = store.subscribe(function () {
            var state = findQualityState(store.state);
            if (!state || applied) return;
            try {
                if (pickRendition(state)) {
                    applied = true;
                    if (unsub) unsub();
                }
            } catch (e) { /* noop */ }
        });
        if (unsub) setTimeout(unsub, 20000);
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

/* Volume & speed */
function applyDefaultVolumeAndRate() {
    var volume = (video_data.params.volume / 100);
    if (volume >= 0 && volume <= 1) player.volume = volume;
    if (video_data.params.speed > 0) player.playbackRate = video_data.params.speed;
}
applyDefaultVolumeAndRate();

/*
 * Cookie persistence for volume and speed (same mechanism as before).
 */
function getCookieValue(name) {
    var cookiePrefix = name + '=';
    var matchedCookie = document.cookie.split(';').find(function (item) {return item.includes(cookiePrefix);});
    if (matchedCookie)
        return matchedCookie.replace(cookiePrefix, '').trim();
    return null;
}

function updateCookie(newVolume, newSpeed) {
    var volumeValue = newVolume !== null ? newVolume : video_data.params.volume;
    var speedValue = newSpeed !== null ? newSpeed : video_data.params.speed;

    var cookieValue = getCookieValue('PREFS');
    var cookieData;

    if (cookieValue !== null) {
        var cookieJson = JSON.parse(decodeURIComponent(cookieValue));
        cookieJson.volume = volumeValue;
        cookieJson.speed = speedValue;
        cookieData = encodeURIComponent(JSON.stringify(cookieJson));
    } else {
        cookieData = encodeURIComponent(JSON.stringify({ 'volume': volumeValue, 'speed': speedValue }));
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
