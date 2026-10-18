module Invidious::Routes::Companion
  HOP_BY_HOP_HEADERS = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade"}

  # GET /companion
  def self.get_companion(env)
    url = env.request.path
    if env.request.query
      url += "?#{env.request.query}"
    end

    headers = sanitize_request_headers(env)

    begin
      COMPANION_POOL.client do |wrapper|
        wrapper.client.get(url, headers) do |resp|
          self.proxy_companion(env, resp, wrapper.companion)
        end
      end
    rescue ex
      LOGGER.error("Companion GET error for #{url}: #{ex.message}")
      if !env.response.closed?
        env.response.status_code = 502
      end
    end
    nil
  end

  # POST /companion
  def self.post_companion(env)
    url = env.request.path
    if env.request.query
      url += "?#{env.request.query}"
    end

    headers = sanitize_request_headers(env)

    begin
      COMPANION_POOL.client do |wrapper|
        wrapper.client.post(url, headers, env.request.body) do |resp|
          self.proxy_companion(env, resp, wrapper.companion)
        end
      end
    rescue ex
      LOGGER.error("Companion POST error for #{url}: #{ex.message}")
      if !env.response.closed?
        env.response.status_code = 502
      end
    end
    nil
  end

  def self.options_companion(env)
    url = env.request.path
    if env.request.query
      url += "?#{env.request.query}"
    end

    headers = sanitize_request_headers(env)

    begin
      COMPANION_POOL.client do |wrapper|
        wrapper.client.options(url, headers) do |resp|
          self.proxy_companion(env, resp, wrapper.companion)
        end
      end
    rescue ex
      LOGGER.error("Companion OPTIONS error for #{url}: #{ex.message}")
      if !env.response.closed?
        env.response.status_code = 502
      end
    end
    nil
  end

  private def self.sanitize_request_headers(env) : HTTP::Headers
    headers = env.request.headers.dup
    # Prevent Crystal HTTP::Client from transparently decompressing gzip responses
    # while leaving upstream Content-Encoding / Content-Length headers intact.
    headers.delete("Accept-Encoding")
    headers.delete("Connection")
    if host = env.request.headers["Host"]?
      headers["Host"] = host
      headers["X-Forwarded-Host"] ||= host
    end
    headers
  end

  private def self.proxy_companion(env, response, companion : Config::CompanionConfig? = nil) : Nil
    env.response.status_code = response.status_code
    response.headers.each do |key, value|
      next if HOP_BY_HOP_HEADERS.includes?(key.downcase)
      env.response.headers[key] = value
    end

    # When proxying DASH manifests through the built-in /companion proxy,
    # ensure any internal companion private_url host in <BaseURL> is rewritten
    # to the client-facing Host so browser segment requests succeed over LAN/Tailscale.
    if env.request.path.includes?("/api/manifest/dash/") && response.status_code == 200
      body = response.body_io.gets_to_end
      if companion && (priv_host = companion.private_url.host) && (req_host = env.request.headers["Host"]?)
        priv_origin = "#{companion.private_url.scheme || "http"}://#{priv_host}"
        priv_origin += ":#{companion.private_url.port}" if companion.private_url.port
        req_scheme = (CONFIG.https_only || Kemal.config.ssl || env.request.headers["X-Forwarded-Proto"]? == "https") ? "https" : "http"
        body = body.gsub(priv_origin, "#{req_scheme}://#{req_host}")
      end
      env.response.headers.delete("Content-Encoding")
      env.response.content_length = body.bytesize
      env.response.write(body.to_slice)
      return nil
    end

    begin
      IO.copy(response.body_io, env.response)
    rescue
      # Ignore client disconnect mid-stream so CompanionConnectionPool does not retry
    end
    nil
  end
end
