'use strict';

function toggle_parent(target) {
    var body = target.parentNode.parentNode.children[1];
    if (body.style.display === 'none') {
        target.textContent = '[ − ]';
        body.style.display = '';
    } else {
        target.textContent = '[ + ]';
        body.style.display = 'none';
    }
}

function swap_comments(event) {
    var target = event.currentTarget || (event.target.closest && event.target.closest('[data-comments]')) || event.target;
    var source = target.getAttribute('data-comments');

    if (source === 'youtube') {
        get_youtube_comments();
    } else if (source === 'reddit') {
        get_reddit_comments();
    }
}

var continue_button = document.getElementById('continue');
if (continue_button) {
    continue_button.onclick = continue_autoplay;
}

function next_video() {
    var url = new URL('https://example.com/watch?v=' + video_data.next_video);

    if (video_data.params.autoplay || video_data.params.continue_autoplay)
        url.searchParams.set('autoplay', '1');
    if (video_data.params.listen !== video_data.preferences.listen)
        url.searchParams.set('listen', video_data.params.listen);
    if (video_data.params.speed !== video_data.preferences.speed)
        url.searchParams.set('speed', video_data.params.speed);
    if (video_data.params.local !== video_data.preferences.local)
        url.searchParams.set('local', video_data.params.local);
    url.searchParams.set('continue', '1');

    location.assign(url.pathname + url.search);
}

function continue_autoplay(event) {
    if (event.target.checked) {
        player.addEventListener('ended', next_video);
    } else {
        player.removeEventListener('ended', next_video);
    }
}

function get_playlist(plid) {
    var playlist = document.getElementById('playlist');

    playlist.innerHTML = spinnerHTMLwithHR;

    var plid_url;
    if (plid.startsWith('RD')) {
        plid_url = '/api/v1/mixes/' + plid +
            '?continuation=' + video_data.id +
            '&format=html&hl=' + video_data.preferences.locale;
    } else {
        plid_url = '/api/v1/playlists/' + plid +
            '?index=' + video_data.index +
            '&continuation=' + video_data.id +
            '&format=html&hl=' + video_data.preferences.locale;
    }

    if (video_data.params.listen) {
        plid_url += '&listen=1'
    }

    helpers.xhr('GET', plid_url, {retries: 5, entity_name: 'playlist'}, {
        on200: function (response) {
            playlist.innerHTML = response.playlistHtml;

            if (!response.nextVideo) return;

            var nextVideo = document.getElementById(response.nextVideo);
            nextVideo.parentNode.parentNode.scrollTop = nextVideo.offsetTop;

            player.addEventListener('ended', function () {
                var url = new URL('https://example.com/watch?v=' + response.nextVideo);

                url.searchParams.set('list', plid);
                if (!plid.startsWith('RD'))
                    url.searchParams.set('index', response.index);
                if (video_data.params.autoplay || video_data.params.continue_autoplay)
                    url.searchParams.set('autoplay', '1');
                if (video_data.params.listen !== video_data.preferences.listen)
                    url.searchParams.set('listen', video_data.params.listen);
                if (video_data.params.speed !== video_data.preferences.speed)
                    url.searchParams.set('speed', video_data.params.speed);
                if (video_data.params.local !== video_data.preferences.local)
                    url.searchParams.set('local', video_data.params.local);

                location.assign(url.pathname + url.search);
            });
        },
        onNon200: function (xhr) {
            playlist.innerHTML = '';
            document.getElementById('continue').style.display = '';
        },
        onError: function (xhr) {
            playlist.innerHTML = spinnerHTMLwithHR;
        },
        onTimeout: function (xhr) {
            playlist.innerHTML = spinnerHTMLwithHR;
        }
    });
}

function get_reddit_comments() {
    var comments = document.getElementById('comments');

    var fallback = comments.innerHTML;
    comments.innerHTML = spinnerHTML;

    var url = '/api/v1/comments/' + video_data.id +
        '?source=reddit&format=html' +
        '&hl=' + video_data.preferences.locale;

    var onNon200 = function (xhr) { comments.innerHTML = fallback; };
    if (video_data.params.comments[1] === 'youtube')
        onNon200 = function (xhr) {};

    helpers.xhr('GET', url, {retries: 5, entity_name: ''}, {
        on200: function (response) {
            comments.innerHTML = (
                '<div class="yt-comments-header">' +
                    '<div class="yt-comments-header-left">' +
                        '<h2 class="yt-comments-title">{title}</h2>' +
                    '</div>' +
                    '<div class="yt-comments-header-right">' +
                        '<a class="yt-comments-chip" href="javascript:void(0)" data-comments="youtube">' +
                            '<i class="icon ion-logo-youtube"></i><span>{youtubeCommentsText}</span>' +
                        '</a>' +
                        '<a class="yt-comments-chip" rel="noopener noreferrer" target="_blank" href="https://reddit.com{permalink}">' +
                            '<i class="icon ion-md-open"></i><span>{redditPermalinkText}</span>' +
                        '</a>' +
                        '<button type="button" class="yt-comments-collapse-btn" title="Toggle comments">' +
                            '<i class="icon ion-ios-arrow-up"></i>' +
                        '</button>' +
                    '</div>' +
                '</div>' +
                '<div class="yt-comments-list">{contentHtml}</div>'
            ).supplant({
                title: response.title,
                youtubeCommentsText: video_data.youtube_comments_text,
                redditPermalinkText: video_data.reddit_permalink_text,
                permalink: response.permalink,
                contentHtml: response.contentHtml
            });

            var collapseBtn = comments.querySelector('.yt-comments-collapse-btn');
            if (collapseBtn) collapseBtn.onclick = toggle_comments;
            var ytBtn = comments.querySelector('[data-comments="youtube"]');
            if (ytBtn) ytBtn.onclick = swap_comments;
        },
        onNon200: onNon200, // declared above
    });
}

if (video_data.play_next) {
    player.addEventListener('ended', function () {
        var url = new URL('https://example.com/watch?v=' + video_data.next_video);

        if (video_data.params.autoplay || video_data.params.continue_autoplay)
            url.searchParams.set('autoplay', '1');
        if (video_data.params.listen !== video_data.preferences.listen)
            url.searchParams.set('listen', video_data.params.listen);
        if (video_data.params.speed !== video_data.preferences.speed)
            url.searchParams.set('speed', video_data.params.speed);
        if (video_data.params.local !== video_data.preferences.local)
            url.searchParams.set('local', video_data.params.local);
        url.searchParams.set('continue', '1');

        location.assign(url.pathname + url.search);
    });
}

addEventListener('load', function (e) {
    if (video_data.plid)
        get_playlist(video_data.plid);

    if (!video_data.comments_enabled && video_data.params.comments.includes("youtube")) {
        return;
    }

    if (video_data.params.comments[0] === 'youtube') {
        get_youtube_comments();
    } else if (video_data.params.comments[0] === 'reddit') {
        get_reddit_comments();
    } else if (video_data.params.comments[1] === 'youtube') {
        get_youtube_comments();
    } else if (video_data.params.comments[1] === 'reddit') {
        get_reddit_comments();
    }
});

var try_reddit_btn = document.getElementById("try-reddit-comments-link");
if (try_reddit_btn) {
    try_reddit_btn.onclick = swap_comments;
}
