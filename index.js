const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
dotenv.config();
const docusign = require("docusign-esign");
const fs = require("fs");
const session = require("express-session");

const app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(session({
   secret: "dfsf94835asda",
   resave: true,
   saveUninitialized: true,
}));

// app.post("/form", async (request, response) => {
//    await checkToken(request);
//    let envelopesApi = getEnvelopesApi(request);
//    let envelope = makeEnvelope(request.body.name, request.body.email, request.body.company);

//    let results = await envelopesApi.createEnvelope(
//        process.env.ACCOUNT_ID, {envelopeDefinition: envelope});
//    console.log("envelope results ", results);
// // Create the recipient view, the Signing Ceremony
//    let viewRequest = makeRecipientViewRequest(request.body.name, request.body.email);
//    results = await envelopesApi.createRecipientView(process.env.ACCOUNT_ID, results.envelopeId,
//        {recipientViewRequest: viewRequest});

//    response.redirect(results.url);
// });
app.post("/form", async (req, res) => {
    await checkToken(req);
    let envelopesApi = getEnvelopesApi(req);
    let envelope = makeEnvelope(req.body.name, req.body.email, req.body.company);

    let results = await envelopesApi.createEnvelope(
        process.env.ACCOUNT_ID, { envelopeDefinition: envelope }
    );

    console.log("Envelope created: ", results);

    let viewRequest = makeRecipientViewRequest(req.body.name, req.body.email);
    let signingResults = await envelopesApi.createRecipientView(process.env.ACCOUNT_ID, results.envelopeId, { recipientViewRequest: viewRequest });

    res.redirect(`/success?envelopeId=${results.envelopeId}`); // Pass envelopeId to success page
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

   // viewRequest.returnUrl = "http://localhost:8000/success";
   viewRequest.returnUrl = process.env.RENDER_URL + "/success";
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

app.get("/download/:envelopeId", async (req, res) => {
    try {
        await checkToken(req); // Ensure a valid token

        let envelopesApi = getEnvelopesApi(req);
        let envelopeId = req.params.envelopeId; // Get envelope ID from URL

        // Get the completed document
        let results = await envelopesApi.getDocument(
            process.env.ACCOUNT_ID, // DocuSign Account ID
            "1", // Document ID (usually "1" for the signed PDF)
            envelopeId,
            null
        );

        let filePath = path.join(__dirname, "signed_document.pdf");
        fs.writeFileSync(filePath, results.body);

        // Send the file for download
        res.download(filePath, "signed_document.pdf", (err) => {
            if (err) {
                console.error("Error downloading file: ", err);
                res.status(500).send("Error downloading the file.");
            } else {
                console.log("File downloaded successfully!");
                fs.unlinkSync(filePath); // Delete after sending
            }
        });

    } catch (error) {
        console.error("Error fetching signed document: ", error);
        res.status(500).send("Error fetching signed document.");
    }
});


// app.get("/success", (request, resposne) => {
//    resposne.send("Success");
// });

app.get("/success", (req, res) => {
    let envelopeId = req.query.envelopeId; // Retrieve envelopeId
    res.send(`
        <h2>Signature Completed!</h2>
        <p>Your document has been signed successfully.</p>
        <a href="/download/${envelopeId}" download>Download Signed Document</a>
    `);
});

// https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=(YOUR CLIENT ID)&redirect_uri=http://localhost:8000/

app.listen(8000, () => {
   console.log("server has started", process.env.USER_ID);
});
