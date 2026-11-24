{
  description = "t3tui local development dependencies (bun) and the headless T3 Code server (t3)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
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
    in
    {
      packages = forAllSystems (pkgs: {
        t3 = mkT3 pkgs;
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
