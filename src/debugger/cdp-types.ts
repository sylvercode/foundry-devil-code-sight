import type ProtocolMappingApi from "devtools-protocol/types/protocol-mapping";

export type RuntimeReleaseObjectParams =
  ProtocolMappingApi.Commands["Runtime.releaseObject"]["paramsType"][0];

export type RuntimeObjectId = RuntimeReleaseObjectParams["objectId"];
