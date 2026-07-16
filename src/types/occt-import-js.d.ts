declare module "occt-import-js" {
  export interface OcctMeshAttribute {
    array: number[];
  }

  export interface OcctBrepFace {
    first: number;
    last: number;
    color: [number, number, number] | null;
  }

  export interface OcctMesh {
    name?: string;
    color?: [number, number, number];
    brep_faces?: OcctBrepFace[];
    attributes: {
      position: OcctMeshAttribute;
      normal?: OcctMeshAttribute;
    };
    index?: OcctMeshAttribute;
  }

  export interface OcctImportResult {
    success: boolean;
    root?: unknown;
    meshes: OcctMesh[];
  }

  export interface OcctModule {
    ReadStepFile(content: Uint8Array, params: unknown): OcctImportResult;
    ReadIgesFile(content: Uint8Array, params: unknown): OcctImportResult;
    ReadBrepFile(content: Uint8Array, params: unknown): OcctImportResult;
  }

  export default function occtimportjs(options?: {
    locateFile?: (file: string) => string;
  }): Promise<OcctModule>;
}
