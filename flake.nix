{
  description = "t3tui, a terminal client for T3 Code (packages: t3tui binary, t3 headless server)";

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

      # Headless T3 Code server CLI (`t3 serve` runs the server with no browser/desktop app).
      # nixpkgs has no t3code package (its `t3` is an unrelated tool) and the npm `t3`
      # package is only a downloader, so fetch the official GitHub release tarball directly.
      # This nightly is 4 commits ahead of the vendor/t3code pin (42c9107983), the closest
      # published build; bump it when the submodule is bumped.
      t3Version = "0.1.12-nightly.20261123.5165";
      t3Assets = {
        "x86_64-linux" = {
          platform = "linux-x64";
          sha256 = "3178eb07779704301177d54df0d5aaf3504ffcfd19d1a2cc4ce23d5f4cd0b073";
        };
        "aarch64-linux" = {
          platform = "linux-arm64";
          sha256 = "d29ff33fa72a979f7cf9ed1b30321cf8938fac012223e8dd5fad5e8fe3aab20b";
        };
        "aarch64-darwin" = {
          platform = "darwin-arm64";
          sha256 = "1c6c9bac20160e83cb7fa15e5dcac1ef4f738ee84583e1afe7b5e5eb724c3485";
        };
      };
      mkT3 =
        pkgs:
        let
          asset =
            t3Assets.${pkgs.system}
              or (throw "t3: no release asset for ${pkgs.system} (linux-x64, linux-arm64, darwin-arm64)");
          src = pkgs.fetchurl {
            url = "https://github.com/pingdotgg/t3code/releases/download/v${t3Version}/t3-${t3Version}-${asset.platform}.tar.gz";
            inherit (asset) sha256;
          };
        in
        pkgs.stdenv.mkDerivation {
          pname = "t3";
          version = t3Version;
          inherit src;
          sourceRoot = "t3-${t3Version}-${asset.platform}";
          # Stripping or patchelf-ing the Node SEA binary corrupts its embedded resource.
          dontStrip = true;
          dontPatchELF = true;
          # The binary resolves its node_modules/client trees relative to itself, so keep
          # the whole release directory together under $out/lib and wrap $out/bin/t3.
          # The main binary is a Node SEA: patchelf corrupts its embedded resource, and it
          # runs on the host loader (/lib64/ld-linux), so leave the binary itself alone and
          # only give the native .node modules an rpath to nix libraries.
          installPhase = ''
            runHook preInstall
            mkdir -p $out/lib $out/bin
            cp -r . $out/lib/t3
            ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
              libPath="${pkgs.lib.makeLibraryPath [
                pkgs.stdenv.cc.cc.lib
                pkgs.zlib
              ]}"
              find $out/lib/t3/node_modules -type f -name '*.node' -print0 |
                while IFS= read -r -d "" f; do
                  ${pkgs.patchelf}/bin/patchelf --set-rpath "$libPath" "$f" || true
                done
            ''}
            printf '%s\n' "#!${pkgs.runtimeShell}" "exec $out/lib/t3/t3 \"\$@\"" > $out/bin/t3
            chmod +x $out/bin/t3
            runHook postInstall
          '';
        };
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
          }.${pkgs.system};
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
            outputHash = "sha256-aLJSI2zpF2lh4sZwul4xD2edHcWiqq/BxJXLltaE5jE=";
            dontFixup = true;
            dontConfigure = true;
            buildPhase = ''
              runHook preBuild
              export HOME=$TMPDIR
              chmod -R u+w .
              bun install --frozen-lockfile
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
        t3 = mkT3 pkgs;
        t3tui = mkT3tui pkgs;
        default = mkT3tui pkgs;
      });

      apps = forAllSystems (pkgs: {
        t3tui = {
          type = "app";
          program = "${self.packages.${pkgs.system}.t3tui}/bin/t3tui";
        };
        default = {
          type = "app";
          program = "${self.packages.${pkgs.system}.t3tui}/bin/t3tui";
        };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.bun
            (mkT3 pkgs)
          ];
        };
      });
    };
}
