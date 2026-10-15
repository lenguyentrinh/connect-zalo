import { CreateMessages1760000000000 } from './1760000000000-CreateMessages.js';
import { CreateGroups1760000000001 } from './1760000000001-CreateGroups.js';
import { RenameThreadIdToGroupId1760000000002 } from './1760000000002-RenameThreadIdToGroupId.js';

/** Register every new migration here; both the app and `npm run migrate` read this list. */
export const migrations = [
  CreateMessages1760000000000,
  CreateGroups1760000000001,
  RenameThreadIdToGroupId1760000000002,
];
