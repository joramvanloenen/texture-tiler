import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root=dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||5173);
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".png":"image/png",".webp":"image/webp",".svg":"image/svg+xml",".json":"application/json"};
createServer((req,res)=>{
 try{
  const url=new URL(req.url,"http://localhost");
  const route=decodeURIComponent(url.pathname)==="/"?"/index.html":decodeURIComponent(url.pathname);
  const path=resolve(root,"."+route);
  if(!path.startsWith(root+sep)){res.writeHead(403);res.end("Forbidden");return}
  const stat=statSync(path);
  if(!stat.isFile()){res.writeHead(404);res.end("Not found");return}
  res.writeHead(200,{"content-type":types[extname(path)]||"application/octet-stream","cache-control":"no-cache"});
  createReadStream(path).pipe(res);
 }catch(err){res.writeHead(404);res.end("Not found")}
}).listen(port,()=>console.log("TileForge Studio available at http://localhost:"+port));
