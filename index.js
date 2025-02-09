const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const cors = require("cors");
const docusign = require("docusign-esign");
const fs = require("fs");
const session = require("express-session");
const FileStore = require("session-file-store")(session);

dotenv.config();

const app = express();

// ✅ Ensure session directory exists
const sessionDir = "/var/tmp/sessions";
if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
    console.log("✅ Created session storage directory:", sessionDir);
}

// ✅ CORS setup for VBCS
app.use(cors({
   origin: process.env.VBCS_URL || "*",
   credentials: true
}));

app.use(bodyParser.urlencoded({ extended: true }));

// ✅ Session Configuration (Render-compatible, Persistent)
app.use(session({
   store: new FileStore({
      path: sessionDir, // ✅ Persistent storage for session
      ttl: 86400, // 1 day expiration
   }),
   secret: "dfsf94835asda",
   resave: false,
   saveUninitialized: false,
   cookie: {
      httpOnly: true,
      secure: true, // ✅ Required for Render HTTPS
      sameSite: "none", // ✅ Required for VBCS cross-origin session sharing
      maxAge: 1000 * 60 * 60 * 24, // 24 hours expiration
   }
}));

// ✅ Debugging Middleware (Logs Session Data Before Requests)
app.use((req, res, next) => {
   console.log("🛠 Session Before Request:", req.session);
   next();
});

// ✅ Route to Handle DocuSign Signing Process
app.post("/form", async (request, response) => {
   try {
      await checkToken(request);
      let envelopesApi = getEnvelopesApi(request);
      let envelope = makeEnvelope(request.body.name, request.body.email, request.body.company);
      let results = await envelopesApi.createEnvelope(process.env.ACCOUNT_ID, { envelopeDefinition: envelope });

      console.log("📄 Envelope Created:", results);

      // ✅ Store envelope ID in session & Explicitly Save Session
      request.session.envelope_id = results.envelopeId;
      request.session.save((err) => {
         if (err) console.error("❌ Error saving session:", err);
         console.log("✅ Session Saved Successfully:", request.session);
      });

      let viewRequest = makeRecipientViewRequest(request.body.name, request.body.email);
      results = await envelopesApi.createRecipientView(process.env.ACCOUNT_ID, results.envelopeId, { recipientViewRequest: viewRequest });

      response.redirect(results.url);
   } catch (error) {
      console.error("❌ Error in /form:", error);
      response.status(500).send("An error occurred while processing your request.");
   }
});

function getEnvelopesApi(request) {
   let dsApiClient = new docusign.ApiClient();
   dsApiClient.setBasePath(process.env.BASE_PATH);
   dsApiClient.addDefaultHeader('Authorization', 'Bearer ' + request.session.access_token);
   return new docusign.EnvelopesApi(dsApiClient);
}

function makeEnvelope(name, email, company) {
   let env = new docusign.EnvelopeDefinition();
   env.templateId = process.env.TEMPLATE_ID;

   let text = docusign.Text.constructFromObject({
      tabLabel: "company_name", value: company
   });

   let tabs = docusign.Tabs.constructFromObject({
      textTabs: [text],
   });

   let signer1 = docusign.TemplateRole.constructFromObject({
      email: email,
      name: name,
      tabs: tabs,
      clientUserId: process.env.CLIENT_USER_ID,
      roleName: 'Team Member'
   });

   env.templateRoles = [signer1];
   env.status = "sent";

   return env;
}

function makeRecipientViewRequest(name, email) {
   let viewRequest = new docusign.RecipientViewRequest();
   viewRequest.returnUrl = `${process.env.RENDER_APP_URL}/success`;
   viewRequest.authenticationMethod = "none";
   viewRequest.email = email;
   viewRequest.userName = name;
   viewRequest.clientUserId = process.env.CLIENT_USER_ID;

   return viewRequest;
}

// ✅ Fixes Session Persistence Issues by Explicitly Saving Session
async function checkToken(request) {
   console.log("🔍 Session Before Checking Token:", request.session);

   if (request.session.access_token && Date.now() < request.session.expires_at) {
      console.log("🔑 Reusing Access Token:", request.session.access_token);
   } else {
      console.log("🔄 Generating a New Access Token");

      let dsApiClient = new docusign.ApiClient();
      dsApiClient.setBasePath(process.env.BASE_PATH);

      const results = await dsApiClient.requestJWTUserToken(
         process.env.INTEGRATION_KEY,
         process.env.USER_ID,
         "signature",
         fs.readFileSync(path.join(__dirname, "private.key")),
         3600
      );

      console.log("✅ Access Token Results:", results.body);
      request.session.access_token = results.body.access_token;
      request.session.expires_at = Date.now() + (results.body.expires_in - 60) * 1000;

      request.session.save((err) => {
         if (err) console.error("❌ Error Saving Session:", err);
         console.log("✅ Session Saved Successfully:", request.session);
      });
   }
}

app.get("/success", (request, response) => {
   console.log("🛠 Session Before Success Page:", request.session);

   if (!request.session.access_token || !request.session.envelope_id) {
      console.log("❌ Missing Session Data:", request.session);
      return response.status(400).send("Session expired or missing required information.");
   }

   response.send(`
      <html>
      <head><title>Success</title></head>
      <body>
          <h1>🎉 Successfully Signed!</h1>
          <p>Your document has been successfully signed using DocuSign.</p>
          <a href="/">Back to Home</a>
      </body>
      </html>
   `);
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
   console.log(`🚀 Server Started on Port ${PORT}`);
});
