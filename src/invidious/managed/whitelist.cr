require "db"
require "json"
require "uri"

module Invidious::Managed
  module Whitelist
    extend self

    @@channel_ucids = Set(String).new
    @@video_ids = Set(String).new
    @@mutex = Mutex.new
    @@initialized = false

    def init
      return if @@initialized

      # Ensure tables exist
      begin
        PG_DB.exec(<<-SQL
          CREATE TABLE IF NOT EXISTS public.whitelisted_channels (
            ucid text NOT NULL,
            name text NOT NULL,
            handle text DEFAULT '',
            thumbnail_url text DEFAULT '',
            added_by text DEFAULT 'admin',
            created_at timestamp with time zone DEFAULT now(),
            CONSTRAINT whitelisted_channels_ucid_key UNIQUE (ucid)
          );
          CREATE TABLE IF NOT EXISTS public.whitelisted_videos (
            id text NOT NULL,
            title text NOT NULL,
            ucid text DEFAULT '',
            author text DEFAULT '',
            thumbnail_url text DEFAULT '',
            added_by text DEFAULT 'admin',
            created_at timestamp with time zone DEFAULT now(),
            CONSTRAINT whitelisted_videos_id_key UNIQUE (id)
          );
        SQL
        )
      rescue ex
        LOGGER.warn("Managed::Whitelist.init: Could not create tables: #{ex.message}")
      end

      # Load cache into memory
      @@mutex.synchronize do
        @@channel_ucids.clear
        @@video_ids.clear

        begin
          PG_DB.query_each("SELECT ucid FROM whitelisted_channels") do |rs|
            if ucid = rs.read(String?)
              @@channel_ucids.add(ucid)
            end
          end

          PG_DB.query_each("SELECT id FROM whitelisted_videos") do |rs|
            if id = rs.read(String?)
              @@video_ids.add(id)
            end
          end
        rescue ex
          LOGGER.error("Managed::Whitelist.init: Error loading whitelist into cache: #{ex.message}")
        end

        @@initialized = true
      end

      LOGGER.info("Managed::Whitelist loaded #{@@channel_ucids.size} channels and #{@@video_ids.size} videos into memory.")
    end

    def is_channel_whitelisted?(ucid : String?) : Bool
      return true if !CONFIG.managed_mode
      return false if ucid.nil? || ucid.empty?

      @@mutex.synchronize do
        @@channel_ucids.includes?(ucid)
      end
    end

    def is_video_whitelisted?(video_id : String?, channel_ucid : String? = nil) : Bool
      return true if !CONFIG.managed_mode
      return false if video_id.nil? && channel_ucid.nil?

      in_cache = @@mutex.synchronize do
        (video_id && @@video_ids.includes?(video_id)) ||
        (channel_ucid && @@channel_ucids.includes?(channel_ucid))
      end
      return true if in_cache

      # If channel_ucid wasn't provided, check if video exists in DB with an allowed ucid
      if channel_ucid.nil? && video_id
        begin
          db_ucid = PG_DB.query_one?(
            "SELECT ucid FROM channel_videos WHERE id = $1 LIMIT 1",
            video_id,
            as: String?
          )
          if db_ucid && is_channel_whitelisted?(db_ucid)
            return true
          end
        rescue
          # Database lookup error, fallback
        end
      end

      false
    end

    def is_item_whitelisted?(item) : Bool
      return true if !CONFIG.managed_mode

      case item
      when SearchVideo, ChannelVideo
        is_video_whitelisted?(item.id, item.ucid)
      when SearchChannel
        is_channel_whitelisted?(item.ucid)
      when SearchPlaylist
        is_channel_whitelisted?(item.ucid)
      when InvidiousPlaylist
        is_channel_whitelisted?(item.author)
      else
        false
      end
    end

    #
    # Channel operations
    #

    def all_channels : Array(WhitelistedChannel)
      PG_DB.query_all(
        "SELECT ucid, name, handle, thumbnail_url, added_by, created_at FROM whitelisted_channels ORDER BY created_at DESC",
        as: WhitelistedChannel
      )
    rescue
      [] of WhitelistedChannel
    end

    def add_channel(
      ucid : String,
      name : String,
      handle : String = "",
      thumbnail_url : String = "",
      added_by : String = "admin"
    ) : WhitelistedChannel
      ucid = ucid.strip
      name = name.strip

      PG_DB.exec(<<-SQL, ucid, name, handle, thumbnail_url, added_by
        INSERT INTO whitelisted_channels (ucid, name, handle, thumbnail_url, added_by, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (ucid) DO UPDATE SET
          name = EXCLUDED.name,
          handle = EXCLUDED.handle,
          thumbnail_url = EXCLUDED.thumbnail_url,
          added_by = EXCLUDED.added_by;
      SQL
      )

      @@mutex.synchronize do
        @@channel_ucids.add(ucid)
      end

      WhitelistedChannel.new(ucid, name, handle, thumbnail_url, added_by, Time.utc)
    end

    def remove_channel(ucid : String)
      ucid = ucid.strip
      PG_DB.exec("DELETE FROM whitelisted_channels WHERE ucid = $1", ucid)
      @@mutex.synchronize do
        @@channel_ucids.delete(ucid)
      end
    end

    def resolve_and_add_channel(input : String, added_by : String = "admin") : WhitelistedChannel
      clean_input = input.strip

      ucid = extract_ucid(clean_input)
      handle = ""

      if ucid.nil?
        # Try resolving handle or URL via InnerTube API
        resolved_ucid, resolved_handle = resolve_channel_remote(clean_input)
        ucid = resolved_ucid
        handle = resolved_handle || ""
      end

      if ucid.nil? || ucid.empty?
        raise "Could not resolve a valid YouTube Channel ID from '#{input}'"
      end

      # Fetch channel info to obtain author name and avatar
      name = ""
      thumbnail_url = ""
      begin
        channel = get_channel(ucid)
        name = channel.author
      rescue ex
        name = handle.presence || ucid
      end

      add_channel(ucid, name, handle, thumbnail_url, added_by)
    end

    #
    # Video operations
    #

    def all_videos : Array(WhitelistedVideo)
      PG_DB.query_all(
        "SELECT id, title, ucid, author, thumbnail_url, added_by, created_at FROM whitelisted_videos ORDER BY created_at DESC",
        as: WhitelistedVideo
      )
    rescue
      [] of WhitelistedVideo
    end

    def add_video(
      id : String,
      title : String,
      ucid : String = "",
      author : String = "",
      thumbnail_url : String = "",
      added_by : String = "admin"
    ) : WhitelistedVideo
      id = id.strip
      title = title.strip

      PG_DB.exec(<<-SQL, id, title, ucid, author, thumbnail_url, added_by
        INSERT INTO whitelisted_videos (id, title, ucid, author, thumbnail_url, added_by, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          ucid = EXCLUDED.ucid,
          author = EXCLUDED.author,
          thumbnail_url = EXCLUDED.thumbnail_url,
          added_by = EXCLUDED.added_by;
      SQL
      )

      @@mutex.synchronize do
        @@video_ids.add(id)
      end

      WhitelistedVideo.new(id, title, ucid, author, thumbnail_url, added_by, Time.utc)
    end

    def remove_video(id : String)
      id = id.strip
      PG_DB.exec("DELETE FROM whitelisted_videos WHERE id = $1", id)
      @@mutex.synchronize do
        @@video_ids.delete(id)
      end
    end

    def resolve_and_add_video(
      input : String,
      added_by : String = "admin",
      also_whitelist_channel : Bool = false
    ) : WhitelistedVideo
      clean_input = input.strip
      video_id = extract_video_id(clean_input)

      if video_id.nil? || video_id.size != 11
        raise "Invalid YouTube video ID or URL: '#{input}'"
      end

      video = get_video(video_id)
      title = video.title
      author = video.author
      ucid = video.ucid
      thumbnail_url = "/vi/#{video.id}/mqdefault.jpg"

      whitelisted_video = add_video(video_id, title, ucid, author, thumbnail_url, added_by)

      if also_whitelist_channel && !ucid.empty?
        add_channel(ucid, author, "", "", added_by)
      end

      whitelisted_video
    end

    #
    # Import / Export
    #

    def export_json : String
      {
        "channels" => all_channels,
        "videos"   => all_videos,
        "exported_at" => Time.utc.to_s,
      }.to_pretty_json
    end

    def import_json(json_str : String, merge : Bool = true)
      data = JSON.parse(json_str)

      if !merge
        PG_DB.exec("DELETE FROM whitelisted_channels")
        PG_DB.exec("DELETE FROM whitelisted_videos")
        @@mutex.synchronize do
          @@channel_ucids.clear
          @@video_ids.clear
        end
      end

      if channels = data["channels"]?.try &.as_a?
        channels.each do |c|
          if ucid = c["ucid"]?.try &.as_s?
            name = c["name"]?.try(&.as_s?) || ucid
            handle = c["handle"]?.try(&.as_s?) || ""
            thumb = c["thumbnail_url"]?.try(&.as_s?) || ""
            add_channel(ucid, name, handle, thumb, "import")
          end
        end
      end

      if videos = data["videos"]?.try &.as_a?
        videos.each do |v|
          if id = v["id"]?.try &.as_s?
            title = v["title"]?.try(&.as_s?) || id
            ucid = v["ucid"]?.try(&.as_s?) || ""
            author = v["author"]?.try(&.as_s?) || ""
            thumb = v["thumbnail_url"]?.try(&.as_s?) || ""
            add_video(id, title, ucid, author, thumb, "import")
          end
        end
      end
    end

    #
    # Helpers
    #

    private def extract_ucid(input : String) : String?
      if input.matches?(/^UC[\w-]{22}$/)
        return input
      end

      if input.includes?("youtube.com") || input.includes?("invidious") || input.starts_with?("/")
        if match = input.match(/\/channel\/(UC[\w-]{22})/)
          return match[1]
        end
      end

      nil
    end

    private def extract_video_id(input : String) : String?
      if input.matches?(/^[\w-]{11}$/)
        return input
      end

      # e.g. https://www.youtube.com/watch?v=VIDEO_ID
      if match = input.match(/[?&]v=([\w-]{11})/)
        return match[1]
      end

      # e.g. https://youtu.be/VIDEO_ID or /watch?v=...
      if match = input.match(/(?:youtu\.be\/|\/embed\/|\/v\/)([\w-]{11})/)
        return match[1]
      end

      nil
    end

    private def resolve_channel_remote(input : String) : Tuple(String?, String?)
      target_url = input
      handle = nil

      if input.starts_with?("@")
        handle = input
        target_url = "https://www.youtube.com/#{input}"
      elsif !input.starts_with?("http")
        handle = "@#{input}"
        target_url = "https://www.youtube.com/@#{input}"
      end

      begin
        resolved = YoutubeAPI.resolve_url(target_url)
        ucid = resolved.dig?("endpoint", "browseEndpoint", "browseId").try &.as_s?
        return {ucid, handle}
      rescue
        {nil, handle}
      end
    end
  end
end
