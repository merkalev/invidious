module Invidious::Routes::Admin
  extend self

  def dashboard(env)
    locale = env.get("preferences").as(Preferences).locale

    if !Invidious::Managed::Admin.is_admin?(env)
      return login_page(env)
    end

    channels = Invidious::Managed::Whitelist.all_channels
    videos = Invidious::Managed::Whitelist.all_videos

    tab = env.params.query["tab"]? || "channels"
    error = env.params.query["error"]?
    success = env.params.query["success"]?

    templated "admin/dashboard"
  end

  def login_page(env)
    locale = env.get("preferences").as(Preferences).locale

    if Invidious::Managed::Admin.is_admin?(env)
      return env.redirect "/admin"
    end

    error = env.params.query["error"]?
    templated "admin/login"
  end

  def login(env)
    password = env.params.body["password"]? || ""

    if Invidious::Managed::Admin.login(env, password)
      env.redirect "/admin"
    else
      env.redirect "/admin/login?error=Invalid+admin+password"
    end
  end

  def logout(env)
    Invidious::Managed::Admin.logout(env)
    env.redirect "/admin/login?success=Logged+out+successfully"
  end

  def add_channel(env)
    if !Invidious::Managed::Admin.is_admin?(env)
      return env.redirect "/admin/login"
    end

    input = env.params.body["channel_input"]?.try(&.strip) || ""
    if input.empty?
      return env.redirect "/admin?tab=channels&error=Channel+input+cannot+be+empty"
    end

    begin
      Invidious::Managed::Whitelist.resolve_and_add_channel(input, "admin")
      env.redirect "/admin?tab=channels&success=Channel+added+to+whitelist"
    rescue ex
      env.redirect "/admin?tab=channels&error=#{URI.encode_www_form(ex.message || "Failed to resolve channel")}"
    end
  end

  def delete_channel(env)
    if !Invidious::Managed::Admin.is_admin?(env)
      return env.redirect "/admin/login"
    end

    ucid = env.params.body["ucid"]?.try(&.strip) || ""
    if !ucid.empty?
      Invidious::Managed::Whitelist.remove_channel(ucid)
    end

    env.redirect "/admin?tab=channels&success=Channel+removed+from+whitelist"
  end

  def add_video(env)
    if !Invidious::Managed::Admin.is_admin?(env)
      return env.redirect "/admin/login"
    end

    input = env.params.body["video_input"]?.try(&.strip) || ""
    if input.empty?
      return env.redirect "/admin?tab=videos&error=Video+input+cannot+be+empty"
    end

    also_channel = env.params.body["also_channel"]? == "1"

    begin
      Invidious::Managed::Whitelist.resolve_and_add_video(input, "admin", also_whitelist_channel: also_channel)
      env.redirect "/admin?tab=videos&success=Video+added+to+whitelist"
    rescue ex
      env.redirect "/admin?tab=videos&error=#{URI.encode_www_form(ex.message || "Failed to resolve video")}"
    end
  end

  def delete_video(env)
    if !Invidious::Managed::Admin.is_admin?(env)
      return env.redirect "/admin/login"
    end

    id = env.params.body["id"]?.try(&.strip) || ""
    if !id.empty?
      Invidious::Managed::Whitelist.remove_video(id)
    end

    env.redirect "/admin?tab=videos&success=Video+removed+from+whitelist"
  end

  def toggle_managed(env)
    if !Invidious::Managed::Admin.is_admin?(env)
      return env.redirect "/admin/login"
    end

    enabled = env.params.body["managed_mode"]? == "on"
    CONFIG.managed_mode = enabled

    env.redirect "/admin?tab=settings&success=Managed+mode+updated"
  end

  def export_whitelist(env)
    if !Invidious::Managed::Admin.is_admin?(env)
      return env.redirect "/admin/login"
    end

    json = Invidious::Managed::Whitelist.export_json
    env.response.content_type = "application/json"
    env.response.headers["Content-Disposition"] = "attachment; filename=\"invidious_managed_whitelist.json\""
    json
  end

  def import_whitelist(env)
    if !Invidious::Managed::Admin.is_admin?(env)
      return env.redirect "/admin/login"
    end

    json_text = env.params.body["whitelist_json"]?.try(&.strip) || ""
    merge = env.params.body["merge_mode"]? != "replace"

    if json_text.empty?
      return env.redirect "/admin?tab=settings&error=JSON+content+cannot+be+empty"
    end

    begin
      Invidious::Managed::Whitelist.import_json(json_text, merge: merge)
      env.redirect "/admin?tab=settings&success=Whitelist+imported+successfully"
    rescue ex
      env.redirect "/admin?tab=settings&error=#{URI.encode_www_form("Failed to import JSON: #{ex.message}")}"
    end
  end

  def quick_add(env)
    env.response.content_type = "application/json"

    if !Invidious::Managed::Admin.is_admin?(env)
      env.response.status_code = 403
      return {"status" => "error", "message" => "Unauthorized"}.to_json
    end

    ucid = env.params.body["ucid"]?.try(&.strip)
    video_id = env.params.body["video_id"]?.try(&.strip)
    name = env.params.body["name"]?.try(&.strip) || ""
    title = env.params.body["title"]?.try(&.strip) || ""

    if ucid && !ucid.empty?
      Invidious::Managed::Whitelist.add_channel(ucid, name.presence || ucid)
    end

    if video_id && !video_id.empty?
      Invidious::Managed::Whitelist.add_video(video_id, title.presence || video_id, ucid: ucid || "")
    end

    {"status" => "ok", "message" => "Whitelisted successfully"}.to_json
  end

  def quick_remove(env)
    env.response.content_type = "application/json"

    if !Invidious::Managed::Admin.is_admin?(env)
      env.response.status_code = 403
      return {"status" => "error", "message" => "Unauthorized"}.to_json
    end

    ucid = env.params.body["ucid"]?.try(&.strip)
    video_id = env.params.body["video_id"]?.try(&.strip)

    if ucid && !ucid.empty?
      Invidious::Managed::Whitelist.remove_channel(ucid)
    end

    if video_id && !video_id.empty?
      Invidious::Managed::Whitelist.remove_video(video_id)
    end

    {"status" => "ok", "message" => "Removed from whitelist"}.to_json
  end

  def approved_channels(env)
    locale = env.get("preferences").as(Preferences).locale
    channels = Invidious::Managed::Whitelist.all_channels

    templated "managed/approved_channels"
  end
end
