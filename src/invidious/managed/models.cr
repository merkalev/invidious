require "db"
require "json"

module Invidious::Managed
  struct WhitelistedChannel
    include DB::Serializable
    include JSON::Serializable

    property ucid : String
    property name : String
    property handle : String
    property thumbnail_url : String
    property added_by : String
    property created_at : Time

    def initialize(
      @ucid : String,
      @name : String,
      @handle : String = "",
      @thumbnail_url : String = "",
      @added_by : String = "admin",
      @created_at : Time = Time.utc
    )
    end
  end

  struct WhitelistedVideo
    include DB::Serializable
    include JSON::Serializable

    property id : String
    property title : String
    property ucid : String
    property author : String
    property thumbnail_url : String
    property added_by : String
    property created_at : Time

    def initialize(
      @id : String,
      @title : String,
      @ucid : String = "",
      @author : String = "",
      @thumbnail_url : String = "",
      @added_by : String = "admin",
      @created_at : Time = Time.utc
    )
    end
  end
end
