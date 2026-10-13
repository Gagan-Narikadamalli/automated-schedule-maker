"""Bearer-authenticated optimizer HTTP service. Deploy behind HTTPS proxy."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from solver import solve
import os, hmac, json, logging
SECRET=os.getenv("OPTIMIZER_BEARER_TOKEN","")
MAX_BYTES=2_000_000
class Handler(BaseHTTPRequestHandler):
    def respond(self,code,data):
        raw=json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type","application/json")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def do_GET(self):
        if self.path=="/health":
            return self.respond(200,{"ok":True,"service":"AI optimizer"})
        return self.respond(404,{"error":"Not found"})
    def do_POST(self):
        if self.path!="/solve":return self.respond(404,{"error":"Not found"})
        auth=self.headers.get("Authorization","")
        if len(SECRET)<32 or not hmac.compare_digest(auth,"Bearer "+SECRET):
            return self.respond(401,{"error":"Unauthorized"})
        try:
            length=int(self.headers.get("Content-Length","0"))
            if length<1 or length>MAX_BYTES:return self.respond(413,{"error":"Invalid request size"})
            data=json.loads(self.rfile.read(length))
            result=solve(data)
            return self.respond(200 if result.get("success") else 422,result)
        except (ValueError,TypeError,KeyError) as e:
            return self.respond(422,{"error":str(e)[:250]})
        except Exception:
            logging.exception("Optimizer failure")
            return self.respond(503,{"error":"Optimizer unavailable"})
if __name__=="__main__":
    if len(SECRET)<32:raise RuntimeError("Set a strong OPTIMIZER_BEARER_TOKEN")
    ThreadingHTTPServer((os.getenv("OPTIMIZER_BIND","127.0.0.1"),int(os.getenv("PORT","8765"))),Handler).serve_forever()
