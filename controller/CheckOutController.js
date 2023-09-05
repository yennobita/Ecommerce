const ShoppingCart = require("../models/ShoppingCart");
const ProductOrder = require("../models/ProductOrder");
const User = require("../models/User");
const Notification = require("../models/Notification");
const Product = require("../models/Product");
const CheckOut = require("../models/CheckOut");
const env = require("dotenv").config();
const config = require("../config/default.json");
(module.exports = {
  getIndex: async (req, res) => {
    if (!req.user) {
      res.redirect("/login?error=notLoggedIn");
      return;
    }
    const user = await User.findOne({ email: req.user.email });
    const shoppingCart = await ShoppingCart.findById(user.idShoppingCart);
    let listProductOrder = [];
    let sumPrice = 0;
    for await (let idProductOrder of shoppingCart.listProductOrder) {
      let productOrder = await ProductOrder.findById(idProductOrder).lean();

      productOrder.sumPriceProduct =
        productOrder.quantity * productOrder.unitPrice;
      sumPrice += productOrder.sumPriceProduct;
      listProductOrder.push(productOrder);
    }

    const errorNumberPhone = req.query.error;
    const errorListProduct = req.query.errorListProduct;
    res.render("checkout/checkout", {
      listProductOrder: listProductOrder,
      sumPrice: sumPrice,
      errorNumberPhone: errorNumberPhone,
      errorListProduct: errorListProduct,
      admin_url: process.env.ADMIN_URL,
    });
  },
  postCheckOut: async (req, res) => {
    const { numberPhone, emailUser, note } = req.body;
    if (!numberPhone || !validate(numberPhone)) {
      res.redirect("/checkout?error=numberPhone");
      return;
    }

    const user = await User.findOne({ email: req.user.email });
    const shoppingCartUser = await ShoppingCart.findById(user.idShoppingCart);
    if (shoppingCartUser.listProductOrder.length <= 0) {
      res.redirect("/checkout?errorListProduct=errorListProduct");
      return;
    }
    const newCheckOut = new CheckOut({
      email: req.user.email,
      numberPhone: numberPhone,
      idShoppingCart: user.idShoppingCart,
      note: note,
      status: "Pending",
    });

    await newCheckOut.save((err) => {
      if (err) {
        console.log(err);
      }
    });
    const newShoppingCart = await new ShoppingCart({
      listProductOrder: [],
      status: false,
      purchasedTime: new Date().toLocaleString(),
    });
    await newShoppingCart.save(async (err, data) => {
      if (err) {
        console.log(err);
      } else {
        try {
          await User.findOneAndUpdate(
            { email: req.user.email },
            {
              idShoppingCart: data._id,
              $addToSet: {
                listIdShoppingCartHistory: user.idShoppingCart,
              },
            }
          );
        } catch (error) {
          console.log(error);
        }
      }
    });

    await Notification.create({
      title: "Đặt hàng",
      content: `Khách hàng ${req.body.name} đã đặt hàng`,
      time: new Date().toLocaleString(),
      seen: false,
    });
    // Tạo đơn hàng thanh toán VNPAY
    const orderId = moment().format("YYYYMMDDHHmmss"); // Thay đổi mã đơn hàng theo cách bạn muốn
    const amount = sumPrice * 100; // Số tiền cần thanh toán (đã nhân 100 theo yêu cầu của VNPAY)

    const vnpUrl = config.get("vnp_Url");
    const returnUrl = config.get("vnp_ReturnUrl");
    const tmnCode = config.get("vnp_TmnCode");
    const secretKey = config.get("vnp_HashSecret");

    // Tạo các tham số cần thiết cho URL thanh toán
    const vnp_Params = {
      vnp_Version: "2.1.0",
      vnp_Command: "pay",
      vnp_TmnCode: tmnCode,
      vnp_Locale: "vn", // Ngôn ngữ (vn hoặc en)
      vnp_CurrCode: "VND",
      vnp_TxnRef: orderId,
      vnp_OrderInfo: `Thanh toán cho mã GD: ${orderId}`,
      vnp_OrderType: "other",
      vnp_Amount: amount,
      vnp_ReturnUrl: returnUrl,
      vnp_IpAddr: req.ip,
      vnp_CreateDate: moment().format("YYYYMMDDHHmmss"),
    };

    // Sắp xếp tham số và tạo chữ ký
    const sortedParams = sortObject(vnp_Params);
    const querystring = require("qs");
    const signData = querystring.stringify(sortedParams, { encode: false });
    const crypto = require("crypto");
    const hmac = crypto.createHmac("sha512", secretKey);
    const signed = hmac.update(new Buffer(signData, "utf-8")).digest("hex");
    vnp_Params["vnp_SecureHash"] = signed;

    await newCheckOut.save();
    // Tạo URL thanh toán và chuyển hướng người dùng
    const paymentUrl =
      vnpUrl + "?" + querystring.stringify(vnp_Params, { encode: false });
    res.redirect(paymentUrl);
  },
}),
  function validate(phone) {
    const regex = /^\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})$/;
    return regex.test(phone);
  };
