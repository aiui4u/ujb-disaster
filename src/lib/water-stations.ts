// Verified station code/location pairs from K-water's published water-resource station table.
// Historical names are retained; live observations are matched by code, never inferred from code prefixes.
// Source: https://www.kwater.or.kr/download/water/info_stat01.pdf
export type WaterStation={code:string;city:string;name:string;river:string};
export const WATER_STATIONS:WaterStation[]=[
 {code:'1018665',city:'의정부시',name:'신곡교',river:'중랑천'},
 {code:'1023670',city:'파주시',name:'통일대교',river:'임진강'},
 {code:'1101610',city:'안성시',name:'안성교',river:'안성천'},
 {code:'1101620',city:'안성시',name:'공도',river:'안성천'},
 {code:'1101635',city:'평택시',name:'군문교',river:'안성천'},
 {code:'1101645',city:'오산시',name:'탑동대교',river:'오산천'},
 {code:'1101650',city:'화성시',name:'수직교',river:'황구지천'},
 {code:'1101663',city:'평택시',name:'진위교',river:'진위천'},
 {code:'1101665',city:'평택시',name:'회화',river:'진위천'},
 {code:'1101670',city:'평택시',name:'동연교',river:'진위천'},
 {code:'1101680',city:'평택시',name:'팽성대교',river:'안성천'}
];
