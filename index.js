const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
require("dotenv").config();
const cors = require("cors");
app.use(cors());
app.use(express.json());
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gubl8vg.mongodb.net/?appName=Cluster0`;
//stripe

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const myDB = client.db("xports");
    const userCollection = myDB.collection("users");
    const contestCollection = myDB.collection("contests");
    const submissionsCollection = myDB.collection("submissions");
    const paymentsCollection = myDB.collection("payments");

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: "user exists" });
      }
      const result = userCollection.insertOne(user);
      res.send(result);
      console.log(user);
    });

    app.get("/users", async (req, res) => {
      const cursor = await userCollection.find().toArray();
      res.send(cursor);
    });

    app.post("/contests", async (req, res) => {
      const data = req.body;
      console.log(data);
      const result = await contestCollection.insertOne(data);
      res.send(result);
    });
    app.get("/contests", async (req, res) => {
      const skip = parseInt(req.query.skip);
      const limit = parseInt(req.query.limit);
      const type = req.query.type;
      let query = {};
      if (type && type !== "All") {
        query = { contestType: type };
      }
      const result = await contestCollection
        .find(query)
        .skip(skip)
        .limit(limit)
        .sort({ participantsCount: -1 })
        .toArray();
      const total = await contestCollection.countDocuments(query);
      res.send({
        contests: result,
        total: total,
      });
    });

    app.get("/contests/:id", async (req, res) => {
      const id = req.params.id;
      let query = {
        _id: new ObjectId(id),
      };
      const result = await contestCollection.find(query).toArray();
      res.send(result);
    });

    //submissions task
    app.post("/submissions/task", async (req, res) => {
      const data = req.body;
      const { participantEmail, contestId } = req.body;
      let query = {
        participantEmail: participantEmail,
        contestId: contestId,
      };
      const alreadySubmitted = await submissionsCollection.findOne(query);
      if (alreadySubmitted) {
        return res.status(400).send({
          message: "You have already submitted for this contest",
          registered: true,
        });
      }
      console.log(data);
      const result = await submissionsCollection.insertOne(data);
      res.send(result);
    });

    app.get("/submissions/check", async (req, res) => {
      const { email, contestId } = req.query;
      let query = {
        participantEmail: email,
        contestId: contestId,
      };
      const paymentExists = await paymentsCollection.findOne(query);
      if (paymentExists) {
        return res.send({ registered: true });
      }
      res.send({ registered: false });
    });


    //===================payment related api====================

    app.post("/create-checkout-session", async (req, res) => {
      const submitInfo = req.body
      const amount = parseInt(submitInfo.price) * 100

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data : {
              currency : 'usd',
              unit_amount: amount,
              product_data : {
                name : `Please pay for : ${submitInfo.contestName}`
              }
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata:{
          contestId : submitInfo.contestId
        },
        customer_email : submitInfo.participantEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({url : session.url});
    });

    app.get("/checkout-session/:sessionId",async(req,res)=>{
      try{
        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId)
        res.send({
          transactionId:session.payment_intent,
          contestId : session.metadata.contestId,
          email : session.customer_email,
          paymentStatus : session.payment_status,
          amount : session.amount_total,
        })
      }catch(error){
        res.status(400).send({error:error.message})
      }
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (error) {
    console.log(error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
