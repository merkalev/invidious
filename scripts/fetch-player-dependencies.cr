require "http"
require "yaml"
require "digest/sha1"
require "option_parser"
require "colorize"

#
# Fetches the Video.js 10 browser bundles (`@videojs/cdn`) into
# assets/videojs/html/.
#
# The package is a self-contained build graph with relative imports; only
# the runtime JavaScript/CSS is kept (dev builds, type declarations and
# source maps are dropped).
#

required_dependencies = File.open("videojs-dependencies.yml") do |file|
  YAML.parse(file).as_h
end

dep_name = "@videojs/cdn"
dep = required_dependencies[dep_name]

unless dep
  STDERR.puts "ERROR: #{dep_name} is missing from videojs-dependencies.yml"
  exit(1)
end

version = dep["version"].as_s

dest_path = "assets/videojs/html"
versions_path = File.join(dest_path, "versions.yml")

# Install detection for the single dependency
needs_install = true
if File.exists?(versions_path)
  config = File.open(versions_path) { |file| YAML.parse(file).as_h }
  needs_install = config["version"].as_s != version
end

unless needs_install
  puts "#{"Player".colorize(:blue)} #{"dependencies".colorize(:green)} are satisfied"
  exit
end

tmp_dir_path = "#{Dir.tempdir}/invidious-videojs-dep-install"
`rm -rf #{tmp_dir_path}`
Dir.mkdir(tmp_dir_path)

download_path = File.join(tmp_dir_path, "package.tgz")

# Scoped npm package tarball URL
url = "https://registry.npmjs.org/%40videojs%2Fcdn/-/cdn-#{version}.tgz"
HTTP::Client.get(url) do |response|
  data = response.body_io.gets_to_end
  File.write(download_path, data)
end

# https://github.com/iv-org/invidious/pull/2397#issuecomment-922375908
if `sha1sum #{download_path}`.split(" ")[0] != dep["shasum"].as_s
  STDERR.puts "Checksum for '#{dep_name}' failed"
  exit(1)
end

`tar -zxf '#{download_path}' -C '#{tmp_dir_path}'`
raise "Extraction for #{dep_name} failed" if !$?.success?

extracted = File.join(tmp_dir_path, "package")
if !File.exists?(File.join(extracted, "video.js"))
  STDERR.puts "entry 'video.js' is missing from #{dep_name}"
  exit(1)
end

# Drop the previous install first
`rm -rf #{dest_path}`
`mkdir -p #{dest_path}`

# Copy the runtime files (skips maps, dev builds and type declarations)
excludes = [
  "--exclude='*.map'",
  "--exclude='*.dev.js'",
  "--exclude='*.dev.d.ts'",
  "--exclude='*.d.ts'",
  "--exclude='*.md'",
  "--exclude='dist/'",
].join(" ")

`tar -cf - #{excludes} -C '#{extracted}' . | tar -xf - -C '#{dest_path}'`

File.open(versions_path, "w") do |io|
  YAML.build(io) do |builder|
    builder.mapping do
      builder.scalar "version"
      builder.scalar version
      builder.scalar "minified"
      builder.scalar false
    end
  end
end

puts "#{"Fetched".colorize(:green)} #{dep_name.colorize(:blue)} #{version}"

# Cleanup
`rm -rf #{tmp_dir_path}`
