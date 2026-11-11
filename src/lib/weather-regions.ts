export const REGIONS=[{id:"city",name:"의정부시청",nx:61,ny:130}] as const;
export type Region=(typeof REGIONS)[number];
export const DEFAULT_REGION=REGIONS[0];
export function findRegion(id:string){return REGIONS.find(r=>r.id===id);}
