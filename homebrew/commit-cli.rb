class CommitCli < Formula
  desc "Write and organize git commits with a coding-agent CLI"
  homepage "https://github.com/saadjs/commit-cli"
  url "https://github.com/saadjs/commit-cli/releases/download/v0.0.0/commit-cli-0.0.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  version "0.0.0"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~EOS
      commit drives a coding-agent CLI, so you need at least one of these on your PATH:
        claude (default), codex, opencode, pi

      Check what it can see with:
        commit --providers
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/commit --version")
    assert_match "claude", shell_output("#{bin}/commit --providers")
    assert_match "not a git repository", shell_output("#{bin}/commit 2>&1", 1)
  end
end
