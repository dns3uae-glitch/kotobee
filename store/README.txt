Ghanima Store - complete digital storefront (Node.js, zero dependencies)

Requirements: Node.js >= 22.5
Run:          node server.js
Storefront:   http://localhost:3000
Admin panel:  http://localhost:3000/admin

First run prints the admin username and password once. Override with:
  ADMIN_USER=owner ADMIN_PASS=YourStrongPass PORT=8080 node server.js

All data lives in ./data (SQLite database, uploads, session key). Back it up.
Full Arabic setup guide: دليل_التركيب.txt
