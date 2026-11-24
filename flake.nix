{
  description = "t3tui, a terminal client for T3 Code";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    # The vendored T3 Code contracts/runtime. The git submodule under vendor/t3code is the
    # source of truth for local development; this input pins the same commit for flake
    # builds, where git submodule contents are not part of the fetched tree.
    t3code = {
      url = "github:pingdotgg/t3code/42c9107983d8f65c38117501cbcde1ee5c82ef14";
      flake = false;
    };
  };

  outputs =
    { self, nixpkgs, t3code, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));

      # t3tui itself, compiled to one self-contained binary with `bun build --compile`.
      # npm dependencies come from a fixed-output derivation (this nixpkgs has no bun
      # fetcher), so the real build is offline. The version comes from package.json.
      mkT3tui =
        pkgs:
        let
          version = (pkgs.lib.importJSON ./package.json).version;
          compileTarget = {
            "x86_64-linux" = "linux-x64";
            "aarch64-linux" = "linux-arm64";
            "aarch64-darwin" = "darwin-arm64";
          }.${pkgs.stdenv.hostPlatform.system};
          # Flake sources from git don't include the submodule's contents, so graft the
          # pinned t3code input in place of vendor/t3code.
          src = pkgs.runCommand "t3tui-src-${version}" { } ''
            cp -r ${./.} "$out"
            chmod -R u+w "$out"
            rm -rf "$out/vendor/t3code"
            # Copied, not symlinked: module resolution must find the project's
            # node_modules above vendor/, and a symlink would resolve to the store.
            cp -r ${t3code} "$out/vendor/t3code"
          '';
          deps = pkgs.stdenvNoCC.mkDerivation {
            pname = "t3tui-deps";
            inherit version src;
            nativeBuildInputs = [
              pkgs.bun
              pkgs.cacert
            ];
            outputHashMode = "recursive";
            outputHashAlgo = "sha256";
            outputHash = "sha256-vaW3HXWIxDu9Iv34UJ63ri3oYsb4g6YFxjO6toF7uJQ=";
            dontFixup = true;
            dontConfigure = true;
            buildPhase = ''
              runHook preBuild
              export HOME=$TMPDIR
              chmod -R u+w .
              # Every platform's optional packages, so this one hash matches on all `systems`:
              # a plain install only fetches the host's @opentui/core-* and the hash would differ.
              bun install --frozen-lockfile --os='*' --cpu='*'
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              mkdir "$out"
              cp -r node_modules "$out/node_modules"
              runHook postInstall
            '';
          };
        in
        pkgs.stdenv.mkDerivation {
          pname = "t3tui";
          inherit version src;
          nativeBuildInputs = [ pkgs.bun ];
          dontConfigure = true;
          # The binary is a Bun SEA: stripping or patching its ELF corrupts the embedded app.
          dontStrip = true;
          dontPatchELF = true;
          dontPatchShebangs = true;
          buildPhase = ''
            runHook preBuild
            export HOME=$TMPDIR
            chmod -R u+w .
            cp -r ${deps}/node_modules .
            chmod -R u+w node_modules
            bun run compile ${compileTarget}
            runHook postBuild
          '';
          installPhase = ''
            runHook preInstall
            install -Dm755 "release/t3tui-${compileTarget}" "$out/bin/t3tui"
            runHook postInstall
          '';
          meta = {
            description = "A terminal client for T3 Code";
            homepage = "https://git.venomade.com/venomade/t3tui";
            license = pkgs.lib.licenses.mit;
            mainProgram = "t3tui";
          };
        };
    in
    {
      packages = forAllSystems (pkgs: {
        t3tui = mkT3tui pkgs;
        default = mkT3tui pkgs;
      });

      apps = forAllSystems (pkgs: {
        t3tui = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.t3tui}/bin/t3tui";
        };
        default = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.t3tui}/bin/t3tui";
        };
      });

      devShells = forAllSystems (pkgs: {
        # Bun only: T3 Code (the `t3` CLI/server) is installed separately, from
        # github.com/pingdotgg/t3code — t3tui finds it via T3TUI_T3_BIN, ~/.t3/bin/t3 or PATH.
        default = pkgs.mkShell {
          packages = [
            pkgs.bun
          ];
        };
      });
    };
}
