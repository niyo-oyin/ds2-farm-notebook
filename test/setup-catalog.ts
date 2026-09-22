import { initializeCatalog } from '../src/data/catalog';
import { loadMasterCatalog } from '../server/master-catalog';

export const testCatalog = loadMasterCatalog();
initializeCatalog(testCatalog);
