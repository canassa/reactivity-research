{
  description = "Reactivity research: how to build reactive UIs, measured";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_latest pkgs.brotli pkgs.jq ]
            # Headless Chrome for the timing and DOM checks; on macOS use an installed Chrome.
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.chromium ];
          shellHook = ''
            ${pkgs.lib.optionalString pkgs.stdenv.isLinux "export CHROME_BIN=${pkgs.chromium}/bin/chromium"}
            unset LD_LIBRARY_PATH
          '';
        };
      });
    };
}
