const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const cors = require("cors");
const docusign = require("docusign-esign");
const fs = require("fs");
const session = require("express-session");

dotenv.config();

const app = express();

app.use(cors({ origin: "*", methods: "GET,POST", allowedHeaders: "Content-Type, Authorization" }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
   secret: "dfsf94835asda",
   resave: true,
   saveUninitialized: true,
}));

app.post("/form", async (req, res) => {
   await checkToken(req);
   let envelopesApi = getEnvelopesApi(req);
   let envelope = makeEnvelope(req.body.name, req.body.email, req.body.company);

   let results = await envelopesApi.createEnvelope(
       process.env.ACCOUNT_ID, { envelopeDefinition: envelope });

   req.session.envelope_id = results.envelopeId;

   let viewRequest = makeRecipientViewRequest(req.body.name, req.body.email);
   results = await envelopesApi.createRecipientView(process.env.ACCOUNT_ID, results.envelopeId,
       { recipientViewRequest: viewRequest });

   res.redirect(results.url);
});

function getEnvelopesApi(req) {
   let dsApiClient = new docusign.ApiClient();
   dsApiClient.setBasePath(process.env.BASE_PATH);
   dsApiClient.addDefaultHeader('Authorization', 'Bearer ' + req.session.access_token);
   return new docusign.EnvelopesApi(dsApiClient);
}

function makeEnvelope(name, email, company) {
   let env = new docusign.EnvelopeDefinition();
   env.templateId = process.env.TEMPLATE_ID;
   let text = docusign.Text.constructFromObject({ tabLabel: "company_name", value: company });

   let tabs = docusign.Tabs.constructFromObject({ textTabs: [text] });

   let signer1 = docusign.TemplateRole.constructFromObject({
      email,
      name,
      tabs,
      clientUserId: process.env.CLIENT_USER_ID,
      roleName: 'Team Member'
   });

   env.templateRoles = [signer1];
   env.status = "sent";

   return env;
}

function makeRecipientViewRequest(name, email) {
   return {
      returnUrl: 'https://docusignnew.onrender.com/success',
      authenticationMethod: 'none',
      email,
      userName: name,
      clientUserId: process.env.CLIENT_USER_ID
   };
}

async function checkToken(req) {
   if (req.session.access_token && Date.now() < req.session.expires_at) {
      console.log("Using existing access token.");
   } else {
      console.log("Generating new access token.");
      let dsApiClient = new docusign.ApiClient();
      dsApiClient.setBasePath(process.env.BASE_PATH);
      const results = await dsApiClient.requestJWTUserToken(
          process.env.INTEGRATION_KEY,
          process.env.USER_ID,
          "signature",
          fs.readFileSync(path.join(__dirname, "private.key")),
          3600
      );
      req.session.access_token = results.body.access_token;
      req.session.expires_at = Date.now() + (results.body.expires_in - 60) * 1000;
   }
}

app.get("/", async (req, res) => {
   await checkToken(req);
   res.sendFile(path.join(__dirname, "main.html"));
});

app.get("/success", (req, res) => {
   if (!req.session.access_token || !req.session.envelope_id) {
      return res.status(400).send("Session expired or missing required information.");
   }

   res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Success</title>
          <style>
              body {
                  font-family: Arial, sans-serif;
                  background-color: #f4f4f9;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  height: 100vh;
                  margin: 0;
              }
              .success-container {
                  text-align: center;
                  background: white;
                  padding: 30px;
                  border-radius: 10px;
                  box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.2);
              }
              .success-icon {
                  font-size: 50px;
                  color: #4CAF50;
              }
              h1 {
                  color: #333;
              }
              p {
                  color: #666;
                  font-size: 18px;
              }
              .btn {
                  display: inline-block;
                  margin-top: 15px;
                  padding: 10px 20px;
                  font-size: 16px;
                  color: white;
                  background-color: #007bff;
                  border: none;
                  border-radius: 5px;
                  text-decoration: none;
                  cursor: pointer;
              }
              .btn:hover {
                  background-color: #0056b3;
              }
          </style>
      </head>
      <body>
          <div class="success-container">
              <div class="success-icon">✔</div>
              <h1>Successfully Signed!</h1>
              <p>Your document has been successfully signed using DocuSign.</p>
              <a href="/" class="btn">Back to Home</a>
              <button class="btn" onclick="window.location.href='/download'">Download Signed Document</button>
          </div>
      </body>
      </html>
   `);
});

// New route to download the signed document securely
app.get("/download", async (req, res) => {
   if (!req.session.access_token || !req.session.envelope_id) {
      return res.status(400).json({ error: "Session expired or missing required information." });
   }

   let dsApiClient = new docusign.ApiClient();
   dsApiClient.setBasePath(process.env.BASE_PATH);
   dsApiClient.addDefaultHeader("Authorization", "Bearer " + req.session.access_token);

   let envelopesApi = new docusign.EnvelopesApi(dsApiClient);
   let envelopeId = req.session.envelope_id;
   let documentId = "1"; // Default DocuSign ID for the signed document

   try {
      let results = await envelopesApi.getDocument(process.env.ACCOUNT_ID, envelopeId, documentId);
      res.setHeader("Content-Disposition", 'attachment; filename="signed_document.pdf"');
      res.setHeader("Content-Type", "application/pdf");
      res.send(results);
   } catch (error) {
      console.error("Error downloading document:", error);
      res.status(500).json({ error: "Failed to download document." });
   }
});

app.listen(8000, () => {
   console.log("Server started on port 8000");
});
