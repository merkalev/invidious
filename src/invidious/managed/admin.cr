require "openssl/hmac"

module Invidious::Managed
  module Admin
    extend self

    COOKIE_NAME = "ADMIN_TOKEN"

    def is_admin?(env : HTTP::Server::Context) : Bool
      # 1. Check signed ADMIN_TOKEN cookie
      if cookie = env.request.cookies[COOKIE_NAME]?
        if validate_token(cookie.value)
          return true
        end
      end

      # 2. Check if logged-in user is listed in CONFIG.admins
      if user = env.get?("user").try &.as?(Invidious::User)
        if CONFIG.admins.includes?(user.email)
          return true
        end
      end

      # 3. Check X-Admin-Key header (for automated scripts or API access)
      expected_pwd = CONFIG.admin_password.presence || "admin"
      if header_key = env.request.headers["X-Admin-Key"]?
        return header_key == expected_pwd
      end

      false
    end

    def login(env : HTTP::Server::Context, password_attempt : String) : Bool
      expected_pwd = CONFIG.admin_password.presence || "admin"

      if password_attempt == expected_pwd
        token = generate_token
        cookie = HTTP::Cookie.new(
          name: COOKIE_NAME,
          value: token,
          path: "/",
          expires: Time.utc + 30.days,
          http_only: true,
          secure: (Kemal.config.ssl || CONFIG.https_only) ? true : false,
          samesite: HTTP::Cookie::SameSite::Lax
        )
        env.response.cookies << cookie
        return true
      end

      false
    end

    def logout(env : HTTP::Server::Context)
      cookie = HTTP::Cookie.new(
        name: COOKIE_NAME,
        value: "",
        path: "/",
        expires: Time.unix(0),
        http_only: true
      )
      env.response.cookies << cookie
    end

    private def generate_token : String
      timestamp = Time.utc.to_unix
      payload = "admin|#{timestamp}"
      sig = OpenSSL::HMAC.hexdigest(:sha256, HMAC_KEY, payload)
      "#{payload}|#{sig}"
    end

    private def validate_token(token : String) : Bool
      parts = token.split("|")
      return false if parts.size != 3
      return false if parts[0] != "admin"

      timestamp = parts[1].to_i64?
      return false if timestamp.nil?

      # Token expires after 30 days
      age = Time.utc.to_unix - timestamp
      return false if age < 0 || age > 30 * 86400

      expected_sig = OpenSSL::HMAC.hexdigest(:sha256, HMAC_KEY, "admin|#{timestamp}")
      Crypto::Subtle.constant_time_compare(parts[2], expected_sig)
    rescue
      false
    end
  end
end
