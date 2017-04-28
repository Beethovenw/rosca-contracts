"use strict";

// This test checks much of the functionality only against ETH ROSCA.
// It tests against ERC20 ROSCAs only where relevant.

let Promise = require("bluebird");
let co = require("co").wrap;
let assert = require('chai').assert;
let utils = require("./utils/utils.js");
let ROSCATest = artifacts.require('ROSCATest.sol');


contract('ROSCA contribute Unit Test', function(accounts) {
    // Parameters for new ROSCA creation
    const ROUND_PERIOD_IN_SECS = 100;
    const MEMBER_LIST = [accounts[1], accounts[2], accounts[3]];
    const CONTRIBUTION_SIZE = 1e16;
    const SERVICE_FEE_IN_THOUSANDTHS = 2;
    const START_TIME_DELAY = 10; // 10 seconds buffer

    let createETHandERC20Roscas = co(function* () {
      let ethRosca = yield utils.createEthROSCA(ROUND_PERIOD_IN_SECS, CONTRIBUTION_SIZE, START_TIME_DELAY,
          MEMBER_LIST, SERVICE_FEE_IN_THOUSANDTHS);
      let erc20Rosca = yield utils.createERC20ROSCA(ROUND_PERIOD_IN_SECS, CONTRIBUTION_SIZE, START_TIME_DELAY,
          MEMBER_LIST, SERVICE_FEE_IN_THOUSANDTHS, accounts);
      return {ethRosca: ethRosca, erc20Rosca: erc20Rosca};
    });

    it("throws when calling contribute from a non-member", co(function* () {
      let roscas = yield createETHandERC20Roscas();
      for (let rosca of [roscas.ethRosca, roscas.erc20Rosca]) {
        // check if valid contribution can be made
        yield utils.contribute(rosca, accounts[2], CONTRIBUTION_SIZE);

        // check throws when contributing from non-member.
        yield utils.assertThrows(utils.contribute(rosca, accounts[4], CONTRIBUTION_SIZE),
            "calling contribute from a non-member success");
      }
    }));

    it("throws when contributing after end of Rosca", co(function* () {
        utils.mineOneBlock(); // mine an empty block to ensure latest's block timestamp is the current Time

        let latestBlock = web3.eth.getBlock("latest");
        let blockTime = latestBlock.timestamp;

        let rosca = yield ROSCATest.new(
            0  /* use ETH */,
            ROUND_PERIOD_IN_SECS, CONTRIBUTION_SIZE, blockTime + START_TIME_DELAY, MEMBER_LIST,
            SERVICE_FEE_IN_THOUSANDTHS);

        for (let i = 0; i < MEMBER_LIST.length + 2; i++) {
            utils.increaseTime(ROUND_PERIOD_IN_SECS);
            yield rosca.startRound();
        }

        utils.assertThrows(rosca.contribute({from: accounts[0], value: CONTRIBUTION_SIZE}));
    }));

    it("generates a LogContributionMade event after a successful contribution", co(function* () {
      let roscas = yield createETHandERC20Roscas();
      for (let rosca of [roscas.ethRosca, roscas.erc20Rosca]) {
        const ACTUAL_CONTRIBUTION = CONTRIBUTION_SIZE * 0.1;

        let eventFired = false;
        let contributionMadeEvent = rosca.LogContributionMade();  // eslint-disable-line new-cap
        contributionMadeEvent.watch(function(error, log) {
            contributionMadeEvent.stopWatching();
            eventFired = true;
            assert.equal(log.args.user, accounts[1], "LogContributionMade doesn't display proper user value");
            assert.equal(log.args.amount.toNumber(), ACTUAL_CONTRIBUTION,
                "LogContributionMade doesn't display proper amount value");
        });

        yield utils.contribute(rosca, accounts[1], ACTUAL_CONTRIBUTION);

        yield Promise.delay(500); // 300ms delay to allow the event to fire properly
        assert.isOk(eventFired, "LogContributionMade event did not fire");
      }
    }));

    it("Checks whether the contributed value gets registered properly", co(function* () {
      let roscas = yield createETHandERC20Roscas();
      for (let rosca of [roscas.ethRosca, roscas.erc20Rosca]) {
        const CONTRIBUTION_CHECK = CONTRIBUTION_SIZE * 1.2;

        yield utils.contribute(rosca, accounts[2], CONTRIBUTION_SIZE * 0.2);
        yield utils.contribute(rosca, accounts[2], CONTRIBUTION_SIZE);

        let creditAfter = (yield rosca.members.call(accounts[2]))[0];

        assert.equal(creditAfter, CONTRIBUTION_CHECK, "contribution's credit value didn't get registered properly");
      }
    }));

    it("checks delinquent winner who contributes the right amount no longer considered delinquent",
      co(function* () {
        let members = [accounts[1], accounts[2]];
        let rosca = yield utils.createEthROSCA(ROUND_PERIOD_IN_SECS, CONTRIBUTION_SIZE, START_TIME_DELAY,
            members, SERVICE_FEE_IN_THOUSANDTHS);
        let DEFAULT_POT = MEMBER_LIST.length * CONTRIBUTION_SIZE;
        utils.increaseTime(START_TIME_DELAY);
        yield Promise.all([
            rosca.startRound(),
            rosca.contribute({from: accounts[1], value: 0.5 * CONTRIBUTION_SIZE}),
            rosca.contribute({from: accounts[0], value: 0.5 * CONTRIBUTION_SIZE}),
            rosca.contribute({from: accounts[2], value: CONTRIBUTION_SIZE}),
            rosca.bid(DEFAULT_POT * 0.8, {from: accounts[2]}),
        ]);

        utils.increaseTime(ROUND_PERIOD_IN_SECS);
        yield rosca.startRound();

        let winnerAddress = 0;

        let eventFired = false;
        let fundsReleasedEvent = rosca.LogRoundFundsReleased();    // eslint-disable-line new-cap
        fundsReleasedEvent.watch(function(error, log) {
            fundsReleasedEvent.stopWatching();
            eventFired = true;
            winnerAddress = log.args.winnerAddress;
        });

        utils.increaseTime(ROUND_PERIOD_IN_SECS);
        yield rosca.startRound();

        yield Promise.delay(300);
        // winnerAddress's credit should be 0.5 + 3(defaultPot) * fee
        // requirement to get Out of debt = 3(currentRound) + 3(defaultPot) * fee
        // so credit must be at least = 3(currentRound) + 3(defaultPot) * fee - totalDiscount
        // so winnerAddress needs to contribute = 2.5 - totalDiscount
        assert.isOk(eventFired, "Fundreleased event did not occured");
        let contributionToNonDelinquency = 2.5 * CONTRIBUTION_SIZE - (yield rosca.totalDiscounts.call());
        yield utils.assertThrows(rosca.withdraw({from: winnerAddress}));
        // for some reason 1 is being rounded up so 10 is used instead
        yield rosca.contribute({from: winnerAddress, value: (contributionToNonDelinquency - 10)});
        yield utils.assertThrows(rosca.withdraw({from: winnerAddress}));
        yield rosca.contribute({from: winnerAddress, value: 10});
        yield rosca.withdraw({from: winnerAddress});
    }));
});
