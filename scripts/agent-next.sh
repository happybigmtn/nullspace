#!/usr/bin/env bash
set -euo pipefail

# Print the next automation priorities from plans/automation-roadmap.yml
# Usage: scripts/agent-next.sh [--stream <id>]

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROADMAP="$ROOT_DIR/plans/automation-roadmap.yml"
STREAM_FILTER="${1:-}"

if ! command -v ruby >/dev/null 2>&1; then
  echo "ruby is required to parse YAML" >&2
  exit 1
fi

ruby - <<'RUBY' "$ROADMAP" "$STREAM_FILTER"
require "yaml"
path, stream_filter = ARGV
doc = YAML.safe_load(File.read(path), symbolize_names: true)
streams = doc.fetch(:streams, [])
streams.select! { |s| s[:id] == stream_filter } unless stream_filter.nil? || stream_filter.empty?

puts "Next automation priorities (status != done):"
streams.each do |s|
  pending = (s[:tasks] || []).select { |t| t[:status] != "done" }
  next if pending.empty?
  puts "- Stream: #{s[:id]} (#{s[:goal]})"
  pending.each do |t|
    puts "  • #{t[:id]} [#{t[:status]}]: #{t[:desc]}"
  end
end
RUBY
