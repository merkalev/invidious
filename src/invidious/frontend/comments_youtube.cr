module Invidious::Frontend::Comments
  extend self

  def template_youtube(comments, locale, thin_mode, is_replies = false)
    String.build do |html|
      root = comments["comments"].as_a
      root.each do |child|
        replies_html = ""
        if child["replies"]?
          replies_count_text = I18n.translate_count(locale,
            "comments_view_x_replies",
            child["replies"]["replyCount"].as_i64 || 0,
            I18n::NumberFormatting::Separator
          )

          replies_html = <<-END_HTML
            <div id="replies" class="yt-comment-replies">
              <div class="yt-replies-trigger-wrap">
                <p class="yt-replies-p">
                  <a class="yt-replies-btn" href="javascript:void(0)" data-continuation="#{child["replies"]["continuation"]}"
                    data-onclick="get_youtube_replies" data-load-replies>
                    <i class="icon ion-ios-arrow-down"></i>
                    <span>#{replies_count_text}</span>
                  </a>
                </p>
              </div>
            </div>
            END_HTML
        elsif comments["authorId"]? && !comments["singlePost"]?
          # for posts we should display a link to the post
          replies_count_text = I18n.translate_count(locale,
            "comments_view_x_replies",
            child["replyCount"].as_i64 || 0,
            I18n::NumberFormatting::Separator
          )

          replies_html = <<-END_HTML
            <div class="yt-comment-replies">
              <div class="yt-replies-trigger-wrap">
                <p class="yt-replies-p">
                  <a class="yt-replies-btn" href="/post/#{child["commentId"]}?ucid=#{comments["authorId"]}">
                    <i class="icon ion-ios-chatbubbles"></i>
                    <span>#{replies_count_text}</span>
                  </a>
                </p>
              </div>
            </div>
            END_HTML
        end

        if !thin_mode
          if child_author_thumbnail = child["authorThumbnail"]?.try &.as_s
            author_thumbnail = "/ggpht#{URI.parse(child_author_thumbnail).request_target}"
          elsif child["authorThumbnails"]?.try { |t| !t.as_a.empty? }
            author_thumbnail = "/ggpht#{URI.parse(child["authorThumbnails"][-1]["url"].as_s).request_target}"
          else
            author_thumbnail = ""
          end
        else
          author_thumbnail = ""
        end

        raw_author = child["author"]?.try(&.as_s?) || ""
        author_name = HTML.escape(raw_author)
        author_initial = raw_author.lstrip('@')[0]?.try(&.upcase.to_s) || "?"
        is_owner = child["authorIsChannelOwner"]?.try(&.as_bool?) == true
        is_verified = child["verified"]?.try(&.as_bool?) == true
        is_pinned = child["isPinned"]?.try(&.as_bool?) == true

        verified_badge = ""
        if is_verified
          verified_badge = %(<i class="icon ion-md-checkmark-circle yt-comment-verified" title="#{I18n.translate(locale, "Verified")}"></i>)
        end

        sponsor_icon = ""
        if child["isSponsor"]?.try &.as_bool
          sponsor_icon = String.build do |str|
            str << %(<img class="yt-comment-sponsor-badge" alt="" )
            str << %(src="/ggpht) << URI.parse(child["sponsorIconUrl"].as_s).request_target << "\" "
            str << %(title=") << I18n.translate(locale, "Channel Sponsor") << "\" "
            str << %(width="16" height="16" />)
          end
        end

        pinned_html = ""
        if is_pinned
          pinned_html = <<-END_HTML
            <div class="yt-comment-pinned">
              <i class="icon ion-md-pin"></i>
              <span>#{I18n.translate(locale, "Pinned")}</span>
            </div>
            END_HTML
        end

        published_unix = child["published"]?.try(&.as_i64?) || 0_i64
        published_tooltip = Time.unix(published_unix).to_s(I18n.translate(locale, "%A %B %-d, %Y"))
        published_ago = I18n.translate(locale, "`x` ago", recode_date(Time.unix(published_unix), locale))
        edited_suffix = child["isEdited"]?.try(&.as_bool?) == true ? " " + I18n.translate(locale, "(edited)") : ""

        permalink_html = ""
        if comments["videoId"]?
          permalink_html = <<-END_HTML
            <a class="yt-comment-permalink" rel="noreferrer noopener" target="_blank" href="https://www.youtube.com/watch?v=#{comments["videoId"]}&lc=#{child["commentId"]}" title="#{I18n.translate(locale, "YouTube comment permalink")}">
              <i class="icon ion-logo-youtube"></i>
            </a>
            END_HTML
        elsif comments["authorId"]?
          permalink_html = <<-END_HTML
            <a class="yt-comment-permalink" rel="noreferrer noopener" target="_blank" href="https://www.youtube.com/channel/#{comments["authorId"]}/community?lb=#{child["commentId"]}" title="#{I18n.translate(locale, "YouTube comment permalink")}">
              <i class="icon ion-logo-youtube"></i>
            </a>
            END_HTML
        end

        avatar_html = if !author_thumbnail.empty?
                        %(<img loading="lazy" class="yt-comment-avatar" src="#{author_thumbnail}" alt="#{author_name}" />)
                      else
                        %(<span class="yt-comment-avatar yt-comment-avatar-fallback">#{HTML.escape(author_initial)}</span>)
                      end

        author_url = child["authorUrl"]?.try(&.as_s?) || "#"

        html << <<-END_HTML
          <div class="yt-comment-thread #{is_replies ? "yt-comment-reply-item" : ""}">
            <div class="yt-comment-avatar-col">
              <a class="yt-comment-avatar-link" href="#{author_url}" tabindex="-1">
                #{avatar_html}
              </a>
            </div>
            <div class="yt-comment-main">
              #{pinned_html}
              <div class="yt-comment-header">
                <a class="yt-comment-author #{is_owner ? "channel-owner yt-comment-owner-pill" : ""}" href="#{author_url}">
                  <span>#{author_name}</span>#{verified_badge}
                </a>
                #{sponsor_icon}
                <span class="yt-comment-time" title="#{published_tooltip}">#{published_ago}#{edited_suffix}</span>
                #{permalink_html}
              </div>
              <div class="yt-comment-body">#{child["contentHtml"]}</div>
          END_HTML

        if child["attachment"]?
          attachment = child["attachment"]

          case attachment["type"]
          when "image"
            attachment = attachment["imageThumbnails"][1]

            html << <<-END_HTML
              <div class="yt-comment-attachment">
                <img loading="lazy" class="yt-comment-attachment-img" src="/ggpht#{URI.parse(attachment["url"].as_s).request_target}" alt="" />
              </div>
              END_HTML
          when "video"
            if attachment["error"]?
              html << <<-END_HTML
                <div class="pure-g video-iframe-wrapper">
                  <p>#{attachment["error"]}</p>
                </div>
                END_HTML
            else
              html << <<-END_HTML
                <div class="pure-g video-iframe-wrapper">
                  <iframe class="video-iframe" src='/embed/#{attachment["videoId"]?}?autoplay=0'></iframe>
                </div>
                END_HTML
            end
          when "multiImage"
            html << <<-END_HTML
              <section class="carousel">
              <a class="skip-link" href="#skip-#{child["commentId"]}">#{I18n.translate(locale, "carousel_skip")}</a>
              <div class="slides">
              END_HTML
            image_array = attachment["images"].as_a

            image_array.each_index do |i|
              html << <<-END_HTML
                  <div class="slides-item slide-#{i + 1}" id="#{child["commentId"]}-slide-#{i + 1}" aria-label="#{I18n.translate(locale, "carousel_slide", {"current" => (i + 1).to_s, "total" => image_array.size.to_s})}" tabindex="0">
                    <img loading="lazy" src="/ggpht#{URI.parse(image_array[i][1]["url"].as_s).request_target}" alt="" />
                  </div>
                END_HTML
            end

            html << <<-END_HTML
              </div>
              <div class="carousel__nav">
              END_HTML
            attachment["images"].as_a.each_index do |i|
              html << <<-END_HTML
                  <a class="slider-nav" href="##{child["commentId"]}-slide-#{i + 1}" aria-label="#{I18n.translate(locale, "carousel_go_to", (i + 1).to_s)}" tabindex="-1" aria-hidden="true">#{i + 1}</a>
                END_HTML
            end
            html << <<-END_HTML
                </div>
                <div id="skip-#{child["commentId"]}"></div>
              </section>
              END_HTML
          end
        end

        like_count_val = child["likeCount"]?.try(&.as_i64?) || 0_i64
        like_count_str = like_count_val > 0 ? number_with_separator(child["likeCount"]) : ""

        html << <<-END_HTML
          <div class="yt-comment-actions">
            <span class="yt-comment-like-pill" title="#{I18n.translate(locale, "Likes")}">
              <i class="icon ion-md-thumbs-up"></i>
              #{!like_count_str.empty? ? "<span class=\"yt-comment-like-count\">#{like_count_str}</span>" : ""}
            </span>
          END_HTML

        if child["creatorHeart"]?
          if !thin_mode
            creator_thumbnail = "/ggpht#{URI.parse(child["creatorHeart"]["creatorThumbnail"].as_s).request_target}"
          else
            creator_thumbnail = ""
          end

          html << <<-END_HTML
            <span class="creator-heart-container" title="#{I18n.translate(locale, "`x` marked it with a ❤", child["creatorHeart"]["creatorName"].as_s)}">
              <span class="creator-heart">
                <img loading="lazy" class="creator-heart-background-hearted" src="#{creator_thumbnail}" alt="" />
                <span class="creator-heart-small-hearted">
                  <span class="icon ion-ios-heart creator-heart-small-container"></span>
                </span>
              </span>
            </span>
            END_HTML
        end

        html << <<-END_HTML
              </div>
              #{replies_html}
            </div>
          </div>
          END_HTML
      end

      if comments["continuation"]?
        html << <<-END_HTML
          <div class="yt-load-more-row">
            <div class="yt-load-more-inner">
              <p>
                <a class="yt-load-more-btn" href="javascript:void(0)" data-continuation="#{comments["continuation"]}"
                  data-onclick="get_youtube_replies" data-load-more #{"data-load-replies" if is_replies}>
                  <i class="icon ion-md-add"></i>
                  <span>#{I18n.translate(locale, "Load more")}</span>
                </a>
              </p>
            </div>
          </div>
          END_HTML
      end
    end
  end
end
