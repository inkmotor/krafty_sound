# A tiny web server for Krafty Sound. Ruby ships with macOS, and every
# response says "don't cache", so a reload always picks up the latest code.
require 'webrick'
port = (ARGV[0] || 8776).to_i
server = WEBrick::HTTPServer.new(
  Port: port, BindAddress: '0.0.0.0', DocumentRoot: File.expand_path(__dir__),
  AccessLog: [], Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN))
server.config[:MimeTypes]['webmanifest'] = 'application/manifest+json'
class << server
  def service(req, res)
    super
    res['Cache-Control'] = 'no-store'
  end
end
trap('INT') { server.shutdown }
server.start
