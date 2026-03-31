# Changelog

All notable changes to the "RISC-V LSP" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [1.2.1] - 2026-03-31

### Added
- **Label hover** hovering over a label now works in a similar fashion to hovering over constants

### Fixed
- Fixed a bug where numbers containing underscores (e.g., `0x0001_0200` or `1_000_000`) were incorrectly parsed as labels.
- Fixed a scoping bug where `EQU` constants were recognized in included files but ignored in the primary file.

## [1.2.0] - 2026-03-31

### Added
- **Multi-File Support:** The LSP now natively parses `include` directives, recursively extracting labels and constants from external files.
- **Go-To-Definition:** Added support for `Cmd/Ctrl + Click` to jump directly to a label or constant's definition, even across included files.
- **Hover Information:** Hovering over a constant now displays its definition, value, and the exact file and line number where it was defined.
- **Constant Support:** Added support for the `EQU` directive to define constants.
- Added support for the `defs` data allocation directive.

### Fixed
- Updated the `li` (Load Immediate) instruction parser to correctly accept numeric constants (hex, binary, octal, decimal) without throwing an "Undefined label" error.


## [1.1.1] - 2026-03-31

### Added
- Initial release of the automated CI/CD pipeline.
- Added foundational Hover and Go-To-Definition capabilities.

## [1.0.0] - 2026-03-31

### Added
- Initial release of the RISC-V Language Server.
- Intelligent diagnostics for undefined and duplicate labels.
- Advanced stack-tracking warnings for memory leaks.
- Custom hardware lab directive support (`defw`, `defb`).