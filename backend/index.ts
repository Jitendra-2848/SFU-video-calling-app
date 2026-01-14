const {app,server} = require("./ws/socket");
import bodyParser from "body-parser";
import cors from "cors"
app.use(cors({
    origin:"*",
    credentials:true,
}))
app.use(bodyParser)




server.listen(3000,()=>{
    console.log("running fast !!");
})