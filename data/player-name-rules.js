"use strict";

/* Static rules used to normalize player names across projection sources.
   Keep these separate from parser logic so future source-specific spelling /
   abbreviation changes can be maintained without touching js/projections.js. */
const PLAYER_NAME_RULES = Object.freeze({
  foldChars: Object.freeze({
    "đ":"d","ø":"o","ł":"l","ß":"ss","æ":"ae","œ":"oe",
    "ı":"i","ð":"d","þ":"th","ħ":"h","ŋ":"n"
  }),
  suffixes: Object.freeze(["jr","sr","ii","iii","iv"]),
  teamAbbreviations: Object.freeze([
    "ATL","BKN","BRK","BOS","CHA","CHO","CHI","CLE","DAL","DEN","DET","GS","GSW",
    "HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NO","NOP","NOH","NY","NYK","OKC","ORL",
    "PHI","PHO","PHX","POR","SA","SAS","SAC","TOR","UTA","UTAH","WAS","WSH"
  ])
});
