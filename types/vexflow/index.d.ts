/**
 * A deliberately empty stand-in for @types/vexflow.
 *
 * opensheetmusicdisplay depends on @types/vexflow 1.x, whose declaration
 * file ends with `declare module "vexflow" { export = Vex; }`. An ambient
 * module declaration like that overrides the real package's own types
 * everywhere in the program, so VexFlow 4's named exports — Stave,
 * StaveNote, Formatter and the rest — appear not to exist.
 *
 * tsconfig.json lists this directory first in `typeRoots`, so a
 * `/// <reference types="vexflow" />` from inside a dependency resolves
 * here instead, and finds nothing. VexFlow's real 4.x types then apply.
 *
 * This file declares no types on purpose. `export {}` makes it a module,
 * which is what keeps it from contributing anything global.
 */
export {};
