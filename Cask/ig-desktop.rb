cask "ig-desktop" do
  version "0.1.5"
  sha256 "05cde7a7071b2e5272387474770a86a8407276a90b309a0aa0a9ccabed0b7e17"

  url "https://github.com/inspektor-gadget/ig-desktop/releases/download/v#{version}/ig-desktop-macos.app.zip"
  name "Inspektor Gadget Desktop"
  desc "Desktop application for Inspektor Gadget - eBPF-based tool for debugging and inspecting Kubernetes resources"
  homepage "https://github.com/inspektor-gadget/ig-desktop"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "ig-desktop.app"

  zap trash: [
    "~/Library/Application Support/io.inspektor-gadget.ig-desktop",
    "~/Library/Caches/io.inspektor-gadget.ig-desktop",
    "~/Library/Preferences/io.inspektor-gadget.ig-desktop.plist",
    "~/Library/Saved Application State/io.inspektor-gadget.ig-desktop.savedState",
  ]
end
