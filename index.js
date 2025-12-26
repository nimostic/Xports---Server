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
    // const paymentsCollection = myDB.collection("payments");

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
      // console.log(user);
    });

    app.get("/users", async (req, res) => {
      const cursor = await userCollection.find().toArray();
      res.send(cursor);
    });

    app.post("/contests", async (req, res) => {
      const data = req.body;
      // console.log(data);
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
    app.get("/my-contests", async (req, res) => {
      const { email } = req.query;
      const query = {
        ownerEmail: email,
      };
      const result = await contestCollection.find(query).toArray();
      const total = await contestCollection.countDocuments(query);
      res.send(result);
    });
    app.delete("/contests/:id", async (req, res) => {
      const { email } = req.query;
      const { id } = req.params;
      const query = {
        _id: new ObjectId(id),
        ownerEmail: email,
      };
      const result = await contestCollection.deleteOne(query);
      res.send(result);
    });
    app.patch("/contests/:id", async (req, res) => {
      const {id} = req.params;
      const { email } = req.query;
      const data = req.body;
      const query = {
        _id: new ObjectId(id),
        ownerEmail: email,
      };

      const updatedDoc = {
        $set: {
          contestName: data.contestName,
          contestType: data.contestType,
          price: data.price,
          prizeMoney: data.prizeMoney,
          instruction: data.instruction,
          description: data.description,
          deadline: data.deadline,
        },
      };

      const result = await contestCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    //submissions task
    app.post("/submissions/task", async (req, res) => {
      const data = req.body;
      // console.log(data);
      const { participantEmail, contestId, submissionLink, submittedAt } =
        req.body;
      let query = {
        participantEmail: participantEmail,
        contestId: contestId,
      };
      const submissions = await submissionsCollection.findOne(query);
      // console.log({submissionsCollection : submissions});
      if (!submissions) {
        return res.status(404).send({
          message: "Registration not found for this contest",
        });
      }
      if (submissions.submissionStatus === "submitted") {
        return res.status(400).send({
          message: "You have already submitted for this contest",
          registered: true,
        });
      }

      const result = await submissionsCollection.updateOne(
        {
          _id: new ObjectId(submissions._id),
        },
        {
          $set: {
            submissionLink: submissionLink,
            submissionStatus: "submitted",
            submittedAt: submittedAt,
          },
        },
        { upsert: true }
      );
      res.send(result);
    });

    app.get("/submissions/check", async (req, res) => {
      const { email, contestId } = req.query;
      // console.log(contestId);
      if (!email || !contestId) {
        return res.status(400).send({ message: "Missing params" });
      }

      let query = {
        participantEmail: email,
        contestId: contestId,
        paymentStatus: "paid",
      };
      const submission = await submissionsCollection.findOne(query);
      if (submission) {
        return res.send({
          registered: true,
          status: submission.submissionStatus,
        });
      }
      res.send({ registered: false });
    });

    //===================payment related api====================

    app.post("/create-checkout-session", async (req, res) => {
      const submitInfo = req.body;
      console.log(submitInfo);
      const amount = parseInt(submitInfo.price) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,

              product_data: {
                name: `Please pay for : ${submitInfo.contestName}`,
                description: submitInfo?.description,
                images: [submitInfo?.image],
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          contestId: submitInfo.contestId,
          participantName: submitInfo.participantName,
          participantPhoto: submitInfo.participantPhoto,
        },
        customer_email: submitInfo.participantEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled/${submitInfo.contestId}`,
      });

      res.send({ url: session.url });
    });

    app.get("/checkout-session/:sessionId", async (req, res) => {
      try {
        const session = await stripe.checkout.sessions.retrieve(
          req.params.sessionId
        );
        res.send({
          transactionId: session.payment_intent,
          contestId: session.metadata.contestId,
          email: session.customer_email,
          paymentStatus: session.payment_status,
          amount: session.amount_total,
        });
      } catch (error) {
        res.status(400).send({ error: error.message });
      }
    });

    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const existingPayment = await submissionsCollection.findOne({
        transactionId: session.payment_intent,
      });
      if (existingPayment) {
        return res.send({ success: true, message: "Already processed" });
      }

      const {
        contestId,
        contestName,
        contestType,
        prizeMoney,
        bannerImage,
        ownerEmail,
      } = await contestCollection.findOne({
        _id: new ObjectId(session.metadata.contestId),
      });
      // console.log(session);
      const submitInfo = {
        contestName: contestName,
        contestId: session.metadata.contestId,
        contestType: contestType,
        bannerImage: bannerImage,
        ownerEmail: ownerEmail,
        participantEmail: session.customer_email,
        participantName: session.metadata.participantName,
        participantPhoto: session.metadata.participantPhoto,
        paymentStatus: session.payment_status,
        transactionId: session.payment_intent,
        submissionStatus: "pending",
        prizeMoney: prizeMoney,
        price: session.amount_total / 100,
        paidAt: new Date(),
      };
      const result = await submissionsCollection.insertOne(submitInfo);

      // update participations in contest
      await contestCollection.updateOne(
        {
          _id: new ObjectId(session.metadata.contestId),
        },
        { $inc: { participantsCount: 1 } }
      );

      return res.send({
        success: true,
      });
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
