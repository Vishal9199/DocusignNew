const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const cors = require('cors');
dotenv.config();
const docusign = require("docusign-esign");
const fs = require("fs");
const session = require("express-session");

const app = express();
// app.use(cors({}));
app.use(cors({ origin: "*", methods: "GET,POST", allowedHeaders: "Content-Type, Authorization, Host" }));
app.use(bodyParser.urlencoded({extended: true}));
app.use(session({
   secret: "dfsf94835asda",
   resave: true,
   saveUninitialized: true,
}));

app.post("/form", async (request, response) => {
   await checkToken(request);
   let envelopesApi = getEnvelopesApi(request);
   let envelope = makeEnvelope(request.body.name, request.body.email, request.body.company);

   let results = await envelopesApi.createEnvelope(
       process.env.ACCOUNT_ID, {envelopeDefinition: envelope});
   console.log("envelope results ", results);
   // Store envelope ID in session
   request.session.envelope_id = results.envelopeId;
// Create the recipient view, the Signing Ceremony
   let viewRequest = makeRecipientViewRequest(request.body.name, request.body.email);
   results = await envelopesApi.createRecipientView(process.env.ACCOUNT_ID, results.envelopeId,
       {recipientViewRequest: viewRequest});

   response.redirect(results.url);
});

function getEnvelopesApi(request) {
   let dsApiClient = new docusign.ApiClient();
   dsApiClient.setBasePath(process.env.BASE_PATH);
   dsApiClient.addDefaultHeader('Authorization', 'Bearer ' + request.session.access_token);
   return new docusign.EnvelopesApi(dsApiClient);
}

function makeEnvelope(name, email, company){
   let env = new docusign.EnvelopeDefinition();
   env.templateId = process.env.TEMPLATE_ID;
   let text = docusign.Text.constructFromObject({
      tabLabel: "company_name", value: company});

   // Pull together the existing and new tabs in a Tabs object:
   let tabs = docusign.Tabs.constructFromObject({
      textTabs: [text],
   });

   let signer1 = docusign.TemplateRole.constructFromObject({
      email: email,
      name: name,
      tabs: tabs,
      clientUserId: process.env.CLIENT_USER_ID,
      roleName: 'Team Member'});

   env.templateRoles = [signer1];
   env.status = "sent";

   return env;
}

function makeRecipientViewRequest(name, email) {

   let viewRequest = new docusign.RecipientViewRequest();

   viewRequest.returnUrl = 'https://docusignnew.onrender.com/success';
   viewRequest.authenticationMethod = 'none';

   // Recipient information must match embedded recipient info
   // we used to create the envelope.
   viewRequest.email = email;
   viewRequest.userName = name;
   viewRequest.clientUserId = process.env.CLIENT_USER_ID;

   return viewRequest
}


async function checkToken(request) {
   if (request.session.access_token && Date.now() < request.session.expires_at) {
      console.log("re-using access_token ", request.session.access_token);
   } else {
      console.log("generating a new access token");
      let dsApiClient = new docusign.ApiClient();
      dsApiClient.setBasePath(process.env.BASE_PATH);
      const results = await dsApiClient.requestJWTUserToken(
          process.env.INTEGRATION_KEY,
          process.env.USER_ID,
          "signature",
          fs.readFileSync(path.join(__dirname, "private.key")),
          3600
      );
      console.log(results.body);
      request.session.access_token = results.body.access_token;
      request.session.expires_at = Date.now() + (results.body.expires_in - 60) * 1000;
   }
}

app.get("/", async (request, response) => {
   await checkToken(request);
   response.sendFile(path.join(__dirname, "main.html"));
});



// app.get("/success", (request, response) => {
//    response.sendFile(path.join(__dirname, "success.html"));
// });


app.get("/success", (request, response) => {
   if (!request.session.access_token || !request.session.envelope_id) {
      return response.status(400).send("Session expired or missing required information.");
   }
   
   response.send(`
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
              <button class="btn" onclick="downloadDocument()">Download Signed Document</button>
          </div>

          <script>
              async function downloadDocument() {
                  const accessToken = "${request.session.access_token}";
                  const baseUrl = "${process.env.BASE_PATH}";
                  const accountId = "${process.env.ACCOUNT_ID}";
                  const envelopeId = "${request.session.envelope_id}";
                  const documentId = "1";
                  const host = "asdfgh3456asdf1234";

                  if (!accessToken || !envelopeId) {
                      alert("Session expired or missing access token and envelope ID.");
                      return;
                  }

                  const url = \`\${baseUrl}/v2.1/accounts/\${accountId}/envelopes/\${envelopeId}/documents/\${documentId}\`;

                  try {
                      const response = await fetch(url, {
                          method: "GET",
                          headers: {
                              "Authorization": \`Bearer \${accessToken}\`,
                              "Accept": "application/pdf",
                              "Host": host
                          }
                      });

                      if (!response.ok) {
                          throw new Error(\`Error: \${response.statusText}\`);
                      }

                      const blob = await response.blob();
                      const downloadUrl = window.URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = downloadUrl;
                      a.download = "signed_document.pdf";
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                  } catch (error) {
                      console.error("Error downloading document:", error);
                      alert("Failed to download document.");
                  }
              }
          </script>
      </body>
      </html>
   `);
});



// https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=(YOUR CLIENT ID)&redirect_uri=http://localhost:8000/


app.listen(8000, () => {
   console.log("server has started", process.env.USER_ID);
});
