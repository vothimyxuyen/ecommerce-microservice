CREATE TABLE "Role" (
  "roleid" SERIAL NOT NULL,
  "rolename" VARCHAR(50) NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("roleid")
);

CREATE TABLE "Membership" (
  "mid" SERIAL NOT NULL,
  "mname" VARCHAR(50) NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Membership_pkey" PRIMARY KEY ("mid")
);

CREATE TABLE "User" (
  "uid" SERIAL NOT NULL,
  "username" VARCHAR(50) NOT NULL,
  "fullname" VARCHAR(100) NOT NULL,
  "password" VARCHAR(255) NOT NULL,
  "roleid" INTEGER NOT NULL,
  "mid" INTEGER NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("uid")
);

CREATE TABLE "Product" (
  "pid" SERIAL NOT NULL,
  "pname" VARCHAR(100) NOT NULL,
  "price" DECIMAL(10,2) NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("pid")
);

CREATE TABLE "Order" (
  "oid" SERIAL NOT NULL,
  "uid" INTEGER NOT NULL,
  "createat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("oid")
);

CREATE TABLE "OrderDetail" (
  "oid" INTEGER NOT NULL,
  "pid" INTEGER NOT NULL,
  "qty" INTEGER NOT NULL,
  "unit_price" DECIMAL(10,2) NOT NULL,
  CONSTRAINT "OrderDetail_pkey" PRIMARY KEY ("oid", "pid")
);

CREATE TABLE "Shipment" (
  "shipid" SERIAL NOT NULL,
  "oid" INTEGER NOT NULL,
  "status" VARCHAR(50) NOT NULL,
  CONSTRAINT "Shipment_pkey" PRIMARY KEY ("shipid")
);

CREATE UNIQUE INDEX "Role_rolename_key" ON "Role"("rolename");
CREATE UNIQUE INDEX "Membership_mname_key" ON "Membership"("mname");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_score_nonnegative" CHECK ("score" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_nonnegative" CHECK ("price" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "OrderDetail" ADD CONSTRAINT "OrderDetail_qty_positive" CHECK ("qty" > 0);

ALTER TABLE "User" ADD CONSTRAINT "User_roleid_fkey"
  FOREIGN KEY ("roleid") REFERENCES "Role"("roleid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_mid_fkey"
  FOREIGN KEY ("mid") REFERENCES "Membership"("mid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_uid_fkey"
  FOREIGN KEY ("uid") REFERENCES "User"("uid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderDetail" ADD CONSTRAINT "OrderDetail_oid_fkey"
  FOREIGN KEY ("oid") REFERENCES "Order"("oid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderDetail" ADD CONSTRAINT "OrderDetail_pid_fkey"
  FOREIGN KEY ("pid") REFERENCES "Product"("pid") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_oid_fkey"
  FOREIGN KEY ("oid") REFERENCES "Order"("oid") ON DELETE CASCADE ON UPDATE CASCADE;
