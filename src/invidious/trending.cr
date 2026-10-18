def fetch_trending(trending_type, region, locale)
  region ||= "US"
  region = region.upcase

  # 2026-10-12: plid is only used in line 47
  # so we can remove this later.
  plid = nil

  case trending_type.try &.downcase
  when "gaming"
    browse_id = "UCOpNcN46UbXVtpKMrmU4Abg"
    params = "Egh0cmVuZGluZw%3D%3D"
  when "livestreams"
    browse_id = "UC4R8DWoMoI7CAwX8_LjQHig"
    params = "EgdsaXZldGFikgEDCKEK"
  else
    # Livestreams is the default one as Youtube removed
    # the aggregated trending page
    # https://github.com/iv-org/invidious/issues/5397#issuecomment-3218928458
    browse_id = "UC4R8DWoMoI7CAwX8_LjQHig"
    params = "EgdsaXZldGFikgEDCKEK"
  end

  client_config = YoutubeAPI::ClientConfig.new(region: region)
  initial_data = YoutubeAPI.browse(browse_id, params: params, client_config: client_config)

  items, _ = extract_items(initial_data)

  extracted = [] of SearchItem

  deduplicate = items.size > 1

  items.each do |itm|
    if itm.is_a?(Category)
      # Ignore very small categories (1-2 items), as they generally contain a sponsored
      # channel, which brings noise on the trending page.
      next if (itm.contents.size < 3 && deduplicate)

      extracted.concat itm.contents.select(SearchItem)
    else
      extracted << itm
    end
  end

  if extracted.empty?
    items.each do |itm|
      if itm.is_a?(Category)
        extracted.concat itm.contents.select(SearchItem)
      else
        extracted << itm
      end
    end
  end

  # Deduplicate items before returning results
  return extracted.select(SearchVideo | ProblematicTimelineItem).uniq!(&.id), plid
end
