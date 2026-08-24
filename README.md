# nineCat

A fantasy basketball draft tool for 9-cat leagues.

I built nineCat to help with the part of drafting that normal rankings don't really account for — how a player fits with the team you've already drafted.

![NineCat draft board](assets/ninecat-preview.png) 

It looks at projected value, category fit, ADP, punt strategies, and who's likely to still be available at your next pick.

### What it does

- 9-cat player rankings
- Adjusts recommendations based on your roster
- Tracks category strengths and weaknesses
- Supports punt strategies
- Uses ADP to account for how long you can wait on a player
- Lets you compare projections against last season
- Tracks the full draft board and other teams

### Try it

**[9cat.fyi](https://9cat.fyi)**

### Projections

nineCat ships with a 500-player 2026–27 projection pool as its default draft pool.

You can replace it with your own projections using the nineCat CSV schema:

`PLAYER,ADP,POS,TEAM,GP,MPG,FGM,FGA,FTM,FTA,3PM,PTS,REB,AST,STL,BLK,TO`

The app validates the full file before replacing the player pool. `R#`, `FG%`, `FT%`, and `TOTAL` are not imported — nineCat calculates percentages, category value, and player rank itself. For reliable Yahoo draft sync, use Yahoo display names in the `PLAYER` column.

Last season's stats are included for comparison.

### Note

nineCat is not affiliated with or endorsed by Yahoo.
