"use strict";

/* Bundled nineCat 2026–27 projection sample in the same canonical CSV
   format exposed to users. Data only: parser/scoring logic lives under js/. */
const PROJECTION_DATASET_META = Object.freeze({
  id: "ninecat-2026-27-sample",
  kind: "bundled",
  label: "2026–27 Projections",
  season: "2026-27",
  updated: "2026-08-24",
  source: "nineCat bundled sample"
});
const RAW = `
PLAYER,ADP,POS,TEAM,GP,MPG,FGM,FGA,FTM,FTA,3PM,PTS,REB,AST,STL,BLK,TO
Nikola Jokic,1.7,C,DEN,72,35.1,10.5,18.3,5.6,6.8,1.8,28.4,12.7,10.4,1.6,0.7,3.5
Victor Wembanyama,2.9,C,SA,66,30.4,9.2,18.3,5.1,6.1,2.2,25.6,11.8,3.6,1.1,3.2,2.9
Shai Gilgeous-Alexander,3.1,PG,OKC,71,33.5,11.1,20.7,8.0,8.9,1.9,32.1,4.7,6.5,1.6,0.9,2.3
Luka Doncic,4.6,PG,LAL,68,35.4,10.6,22.9,7.5,9.6,4.0,32.7,8.7,8.8,1.7,0.5,4.0
Giannis Antetokounmpo,5.3,PF/C,MIA,69,34.2,12.1,19.9,6.9,11.0,0.3,31.4,11.9,6.5,1.0,1.1,3.3
Cade Cunningham,8.2,PG,DET,68,33.9,9.2,19.7,4.6,5.6,2.0,25.0,5.8,9.8,1.3,0.8,4.1
Anthony Edwards,6.8,SG/SF,MIN,74,35.3,9.7,20.0,5.4,6.6,3.7,28.7,5.6,3.5,1.2,0.7,3.0
Tyrese Maxey,16.3,PG/SG,PHI,70,36.1,8.4,18.2,4.6,5.2,2.8,24.2,3.4,5.8,1.8,0.5,2.2
Jayson Tatum,11.3,SF/PF,BOS,68,33.7,9.0,19.4,4.8,5.8,3.3,26.1,8.8,5.8,1.2,0.5,2.8
Stephen Curry,21.1,PG,GS,60,31.6,8.4,18.3,4.3,4.6,4.4,25.4,3.6,5.2,1.0,0.4,2.9
Kevin Durant,25.9,SF/PF,HOU,70,34.6,8.8,16.8,4.8,5.6,2.3,24.7,5.4,4.3,0.8,1.0,2.9
Anthony Davis,12.8,PF/C,WAS,65,31.1,8.6,16.8,4.7,6.1,0.6,22.5,10.9,3.2,1.1,1.9,2.1
Donovan Mitchell,21.7,PG/SG,CLE,72,33.4,9.3,20.1,4.9,5.8,3.3,26.9,4.7,5.4,1.5,0.3,2.6
Tyrese Haliburton,73.2,PG/SG,IND,63,30.9,6.1,13.0,2.4,2.8,2.8,17.3,3.3,9.6,1.3,0.6,1.5
Jamal Murray,36.2,PG,DEN,73,34.8,8.2,17.2,3.9,4.4,2.8,23.2,4.1,6.5,1.1,0.4,2.1
Karl-Anthony Towns,14.4,C,NY,73,31.3,7.6,14.7,4.6,5.4,1.7,21.3,11.8,2.9,0.9,0.6,2.5
Cooper Flagg,23.2,SF/PF,DAL,72,34.1,8.8,18.5,4.4,5.3,1.3,23.3,7.3,4.9,1.3,1.0,2.2
Jalen Johnson,31.9,PF,ATL,72,35.1,8.1,16.8,3.7,4.7,1.5,21.4,10.2,6.9,1.4,0.6,3.3
Kawhi Leonard,49.7,SF/PF,TOR,65,31.1,8.6,17.5,4.4,5.0,2.2,23.7,5.0,3.0,1.7,0.4,1.9
Trae Young,22.2,PG,WAS,70,33.4,7.0,16.0,6.2,7.1,2.7,22.8,2.9,10.8,1.1,0.2,4.3
Trey Murphy III,73.1,SG/SF,NO,68,35.2,7.4,16.0,3.6,4.0,3.2,21.6,5.5,3.7,1.3,0.5,1.9
Scottie Barnes,29.5,SG/SF,TOR,80,34.2,7.5,15.7,3.4,4.3,1.0,19.4,7.9,6.1,1.5,1.3,2.8
Chet Holmgren,43.0,PF/C,OKC,70,29.7,6.3,11.7,3.4,4.4,1.4,17.3,9.1,1.9,0.7,2.1,1.7
James Harden,18.1,PG/SG,CLE,72,33.4,5.9,14.0,5.6,6.4,2.6,20.0,4.6,8.2,1.1,0.5,3.4
Austin Reaves,51.9,PG/SG,LAL,70,34.4,6.9,14.5,5.2,5.9,2.6,21.5,4.6,5.7,1.1,0.3,2.6
Evan Mobley,33.8,PF/C,CLE,72,32.5,7.5,13.7,3.1,4.7,1.1,19.3,9.6,3.6,0.8,1.8,2.1
Kyrie Irving,90.5,PG,DAL,55,31.8,7.5,15.5,3.3,3.7,2.4,20.7,4.0,4.9,1.1,0.4,1.9
Jaren Jackson Jr.,73.0,PF/C,UTA,67,30.7,7.9,16.4,4.0,5.1,2.0,21.8,5.8,2.1,1.2,1.5,2.2
Amen Thompson,20.2,SG/SF,HOU,76,36.2,7.0,13.0,3.7,4.9,0.4,18.1,7.9,4.2,1.5,1.0,2.2
Dejounte Murray,127.4,PG/SG,NO,65,30.7,6.3,13.8,3.2,3.8,1.6,17.3,6.1,7.1,1.8,0.3,3.4
`.trim();
