var video_data = JSON.parse(document.getElementById('video_data').textContent);

var spinnerHTML = '<div class="yt-comments-loading"><div class="loading"><i class="icon ion-ios-refresh"></i></div></div>';
var spinnerHTMLwithHR = spinnerHTML + '<hr>';
var currentCommentSort = 'top';

String.prototype.supplant = function (o) {
    return this.replace(/{([^{}]*)}/g, function (a, b) {
        var r = o[b];
        return typeof r === 'string' || typeof r === 'number' ? r : a;
    });
};

function toggle_comments(event) {
    var target = event.currentTarget || (event.target.closest && event.target.closest('a, button')) || event.target;
    var root = (target.closest && target.closest('#comments')) || target.parentNode.parentNode.parentNode;
    var body = root.querySelector('.yt-comments-list') || root.children[1];
    if (!body) return;
    var icon = target.querySelector('i.icon');
    if (body.style.display === 'none') {
        if (icon) {
            icon.className = 'icon ion-ios-arrow-up';
        } else {
            target.textContent = '[ − ]';
        }
        body.style.display = '';
    } else {
        if (icon) {
            icon.className = 'icon ion-ios-arrow-down';
        } else {
            target.textContent = '[ + ]';
        }
        body.style.display = 'none';
    }
}

function hide_youtube_replies(event) {
    var target = event.currentTarget || (event.target.closest && event.target.closest('a')) || event.target;

    var sub_text = target.getAttribute('data-inner-text');
    var inner_text = target.getAttribute('data-sub-text');

    var container = (target.closest && target.closest('.yt-comment-replies')) || target.parentNode.parentNode;
    var body = container.querySelector('.yt-replies-list') || container.children[1];
    if (body) body.style.display = 'none';

    target.innerHTML = '<i class="icon ion-ios-arrow-down"></i><span>' + sub_text + '</span>';
    target.onclick = show_youtube_replies;
    target.setAttribute('data-inner-text', inner_text);
    target.setAttribute('data-sub-text', sub_text);
}

function show_youtube_replies(event) {
    var target = event.currentTarget || (event.target.closest && event.target.closest('a')) || event.target;

    var sub_text = target.getAttribute('data-inner-text');
    var inner_text = target.getAttribute('data-sub-text');

    var container = (target.closest && target.closest('.yt-comment-replies')) || target.parentNode.parentNode;
    var body = container.querySelector('.yt-replies-list') || container.children[1];
    if (body) body.style.display = '';

    target.innerHTML = '<i class="icon ion-ios-arrow-up"></i><span>' + sub_text + '</span>';
    target.onclick = hide_youtube_replies;
    target.setAttribute('data-inner-text', inner_text);
    target.setAttribute('data-sub-text', sub_text);
}

function get_youtube_comments(sortBy) {
    if (typeof sortBy === 'string' && sortBy) {
        currentCommentSort = sortBy;
    }
    var comments = document.getElementById('comments');

    var fallback = comments.innerHTML;
    comments.innerHTML = spinnerHTML;

    var baseUrl = video_data.base_url || '/api/v1/comments/' + video_data.id;
    var url = baseUrl +
        '?format=html' +
        '&hl=' + video_data.preferences.locale +
        '&thin_mode=' + video_data.preferences.thin_mode +
        '&sort_by=' + encodeURIComponent(currentCommentSort);

    if (video_data.ucid) {
        url += '&ucid=' + video_data.ucid;
    }

    var onNon200 = function (xhr) {
        if (!video_data.comments_enabled) {
            comments.innerHTML = `
            <div id="comments-turned-off-on-video-message" class="yt-comments-disabled-card">
                <p><b>${video_data.comments_youtube_disabled_text}</b></p>
                <p><button href="javascript:void(0)" data-comments="reddit" id="try-reddit-comments-link" class="yt-comments-chip">
                    <i class="icon ion-logo-reddit"></i>
                    <span>${video_data.comments_youtube_disabled_try_reddit}</span>
                </button></p>
            </div>`;

            document.getElementById("try-reddit-comments-link").onclick = swap_comments;
        } else {
            comments.innerHTML = fallback;
        }
    };

    if (video_data.params.comments[1] === 'youtube')
        onNon200 = function (xhr) {};

    helpers.xhr('GET', url, {retries: 5, entity_name: 'comments'}, {
        on200: function (response) {
            var countFormatted = (response.commentCount || 0).toLocaleString();
            var commentsHeading = video_data.comments_text.supplant({
                commentCount: countFormatted
            });
            /* Strip legacy "View " prefix if present so header reads "1,234 Comments" like YouTube */
            commentsHeading = commentsHeading.replace(/^View\s+/i, '');

            var topActiveClass = currentCommentSort === 'top' ? 'yt-sort-pill-active' : '';
            var newActiveClass = currentCommentSort === 'new' ? 'yt-sort-pill-active' : '';

            var commentInnerHtml = '<div class="yt-comments-header">' +
                '<div class="yt-comments-header-left">' +
                    '<h2 class="yt-comments-title">' + commentsHeading + '</h2>' +
                    '<div class="yt-comments-sort-group" role="group" aria-label="Sort comments">' +
                        '<button type="button" class="yt-sort-pill ' + topActiveClass + '" data-sort-comments="top">' +
                            '<i class="icon ion-md-funnel"></i><span>Top</span>' +
                        '</button>' +
                        '<button type="button" class="yt-sort-pill ' + newActiveClass + '" data-sort-comments="new">' +
                            '<i class="icon ion-md-time"></i><span>Newest</span>' +
                        '</button>' +
                    '</div>' +
                '</div>' +
                '<div class="yt-comments-header-right">';

            if (video_data.support_reddit) {
                commentInnerHtml += '<a class="yt-comments-chip" href="javascript:void(0)" data-comments="reddit">' +
                    '<i class="icon ion-logo-reddit"></i><span>{redditComments}</span>' +
                '</a>';
            }

            commentInnerHtml += '<button type="button" class="yt-comments-collapse-btn" title="Toggle comments">' +
                    '<i class="icon ion-ios-arrow-up"></i>' +
                '</button>' +
                '</div>' +
            '</div>' +
            '<div class="yt-comments-list">{contentHtml}</div>';

            commentInnerHtml = commentInnerHtml.supplant({
                contentHtml: response.contentHtml,
                redditComments: video_data.reddit_comments_text
            });
            comments.innerHTML = commentInnerHtml;

            var collapseBtn = comments.querySelector('.yt-comments-collapse-btn');
            if (collapseBtn) collapseBtn.onclick = toggle_comments;

            var redditLink = comments.querySelector('[data-comments="reddit"]');
            if (redditLink) redditLink.onclick = swap_comments;

            comments.querySelectorAll('[data-sort-comments]').forEach(function (btn) {
                btn.onclick = function () {
                    var nextSort = btn.getAttribute('data-sort-comments');
                    if (nextSort && nextSort !== currentCommentSort) {
                        get_youtube_comments(nextSort);
                    }
                };
            });
        },
        onNon200: onNon200,
        onError: function (xhr) {
            comments.innerHTML = spinnerHTML;
        },
        onTimeout: function (xhr) {
            comments.innerHTML = spinnerHTML;
        }
    });
}

function get_youtube_replies(target, load_more, load_replies) {
    var continuation = target.getAttribute('data-continuation');

    var body = target.parentNode.parentNode;
    var fallback = body.innerHTML;
    body.innerHTML = spinnerHTML;
    var baseUrl = video_data.base_url || '/api/v1/comments/' + video_data.id;
    var url = baseUrl +
        '?format=html' +
        '&hl=' + video_data.preferences.locale +
        '&thin_mode=' + video_data.preferences.thin_mode +
        '&continuation=' + continuation;

    if (video_data.ucid) {
        url += '&ucid=' + video_data.ucid;
    }
    if (load_replies) url += '&action=action_get_comment_replies';

    helpers.xhr('GET', url, {}, {
        on200: function (response) {
            if (load_more) {
                body = body.parentNode.parentNode;
                body.removeChild(body.lastElementChild);
                body.insertAdjacentHTML('beforeend', response.contentHtml);
            } else {
                body.removeChild(body.lastElementChild);

                var p = document.createElement('p');
                p.className = 'yt-replies-p';
                var a = document.createElement('a');
                a.className = 'yt-replies-btn';
                p.appendChild(a);

                a.href = 'javascript:void(0)';
                a.onclick = hide_youtube_replies;
                a.setAttribute('data-sub-text', video_data.hide_replies_text);
                a.setAttribute('data-inner-text', video_data.show_replies_text);
                a.innerHTML = '<i class="icon ion-ios-arrow-up"></i><span>' + video_data.hide_replies_text + '</span>';

                var div = document.createElement('div');
                div.className = 'yt-replies-list';
                div.innerHTML = response.contentHtml;

                body.appendChild(p);
                body.appendChild(div);
            }
        },
        onNon200: function (xhr) {
            body.innerHTML = fallback;
        },
        onTimeout: function (xhr) {
            console.warn('Pulling comments failed');
            body.innerHTML = fallback;
        }
    });
}