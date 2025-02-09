const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const cors = require('cors');
const docusign = require("docusign-esign");
const fs = require("fs");
const session = require("express-session");

dotenv.config();

const app = express();

// Session configuration
app.use(cors({}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
   secret: "dfsf94835asda",
   resave: true,
   saveUninitialized: true,
   cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // set to true in production
      maxAge: 1000 * 60 * 60 * 24, // 24 hours expiration
   }
}));

app.post("/form", async (request, response) => {
   // Ensure access token is valid
   await checkToken(request);

   // Get the envelopes API
   let envelopesApi = getEnvelopesApi(request);

   // Create the envelope definition
   let envelope = makeEnvelope(request.body.name, request.body.email, request.body.company);

   // Create the envelope
   let results = await envelopesApi.createEnvelope(process.env.ACCOUNT_ID, { envelopeDefinition: envelope });
   console.log("Envelope created:", results);

   // Store envelope ID in session
   request.session.envelope_id = results.envelopeId;
   console.log("Envelope ID stored in session:", request.session.envelope_id);

   // Create the recipient view (signing ceremony)
   let viewRequest = makeRecipientViewRequest(request.body.name, request.body.email);
   results = await envelopesApi.createRecipientView(process.env.ACCOUNT_ID, results.envelopeId, { recipientViewRequest: viewRequest });

   // Redirect to the signing URL
   response.redirect(results.url);
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
      tabLabel: "company_name",
      value: company
   });

   // Create tabs object
   let tabs = docusign.Tabs.constructFromObject({
      textTabs: [text],
   });

   // Create signer object
   let signer1 = docusign.TemplateRole.constructFromObject({
      email: email,
      name: name,
      tabs: tabs,
      clientUserId: process.env.CLIENT_USER_ID,
      roleName: 'Team Member'
   });

   env.templateRoles = [signer1];
   env.status = "sent"; // Sent for signing

   return env;
}

function makeRecipientViewRequest(name, email) {
   let viewRequest = new docusign.RecipientViewRequest();
   viewRequest.returnUrl = 'https://docusignnew.onrender.com/success'; // Ensure this is your actual return URL
   viewRequest.authenticationMethod = 'none';
   viewRequest.email = email;
   viewRequest.userName = name;
   viewRequest.clientUserId = process.env.CLIENT_USER_ID;

   return viewRequest;
}

async function checkToken(request) {
   // Check if the access token is still valid
   if (request.session.access_token && Date.now() < request.session.expires_at) {
      console.log("Re-using access_token:", request.session.access_token);
   } else {
      console.log("Generating a new access token");

      let dsApiClient = new docusign.ApiClient();
      dsApiClient.setBasePath(process.env.BASE_PATH);

      const results = await dsApiClient.requestJWTUserToken(
         process.env.INTEGRATION_KEY,
         process.env.USER_ID,
         "signature",
         fs.readFileSync(path.join(__dirname, "private.key")),
         3600
      );

      console.log("Access token results:", results.body);
      request.session.access_token = results.body.access_token;
      request.session.expires_at = Date.now() + (results.body.expires_in - 60) * 1000; // Subtract 60 seconds to ensure expiration before it really happens
      console.log("Access token stored in session:", request.session.access_token);
   }
}

// Serve the main page
app.get("/", async (request, response) => {
   await checkToken(request);
   response.sendFile(path.join(__dirname, "main.html"));
});

// Success page after signing
app.get("/success", (request, response) => {
   if (!request.session.access_token || !request.session.envelope_id) {
      console.log("Session data missing:", request.session);
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
                  const documentId = "1"; // Specify the document ID to download

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
                              "Accept": "application/pdf"
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

// Start the server
app.listen(8000, () => {
   console.log("Server has started on port 8000");
});
