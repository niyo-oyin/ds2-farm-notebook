import { createNameSearch } from '../core/name-search';
import data from '../../data/data.json';

/** どの検索欄も同じ表記揺れ・読みを使う。判定用マスターの馬名は変更しない。 */
export const nameSearch = createNameSearch(data.searchAliases);
