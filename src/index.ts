import { ColorResolvable, Message, GuildMember, Collection, MessageReaction, User, MessageEmbed, DMChannel, MessageCollector } from "discord.js";
import Board from "./data/interfaces/Board.interface";
import Boat from "./data/interfaces/Boat.interface";
import Cords from "./data/interfaces/Cords.interface";
import Game from "./data/interfaces/Game.interface";

export class DiscordBattleShip {
    constructor(
        public settings: { 
            embedColor: ColorResolvable, 
            prefix: string, 
        }

    ) { if (!this.settings.embedColor) this.settings.embedColor = "#6b8ba4" };

    /**
     * @param message The message object.
     * To create, handle and finish a new battleship game, call the createGame() method. This method only accepts one parameter, which is the message object. This is also the only method in the package. This method will handle the creation of the game, DMing users, updating each board, attacking the opponent, win states and more. This is all you need to know to create a new game of battle ship! 
     */
    public async createGame (message: Message): Promise<Message> {

        const challenger = <GuildMember>message.member; // Define the challenger
        const opponent = <GuildMember>(<Collection<string, GuildMember>>message.mentions.members).first(); // Get and define the opponent

        if (!opponent) return message.channel.send("Укажите пользователя, с которым хотите сразиться!"); // If there is no opponent, require them to define one
        if (challenger.id === opponent.id) return message.channel.send("Вы не можете сражаться с самим собой!"); // Check for prevention against challenging yourself
   
        const accept = await message.channel.send(`${opponent}! ${challenger.user.tag} хочет сыграть с тобой в морской бой. Принять?`); // Ask if the user would like to play 
        await Promise.all([accept.react("✅"), accept.react("❌")]);

        const acceptFilter = (reaction: MessageReaction, user: User) => user.id === opponent.id && ["✅", "❌"].includes(reaction.emoji.name);
        const acceptedData = await accept.awaitReactions(acceptFilter, { max: 1, time: 30000 });

        if (acceptedData.size < 1) return accept.edit("Похоже, что пользователь не хочет с тобой играть.");

        if ((<MessageReaction>acceptedData.first()).emoji.name === "❌") return accept.edit("К сожалению, пользователь отклонил запрос.");
        
        await accept.delete();

        const trackingEmbed = new MessageEmbed()
            .setTitle("Морской Бой")
            .setFooter(`${challenger.user.tag} vs ${opponent.user.tag}`)
            .setColor(this.settings.embedColor)
            .setDescription("Игра началась! Следуйте инструкциям в личных сообщениях! Это сообщение будет обновляться.");
        const trackMsg = await message.channel.send("", { embed: trackingEmbed });

        const players: Game[] = [
            { collector: null, member: challenger, playerHitBoard: this.genBoard(10, 10), playerShipBoard: this.genBoard(10, 10), gameChannel: "", placedBoats: [], gameMessages: { start: "", hits: "", boats: "" }, ready: false },
            { collector: null, member: opponent , playerHitBoard: this.genBoard(10, 10), playerShipBoard: this.genBoard(10, 10), gameChannel: "", placedBoats: [], gameMessages: { start: "", hits: "", boats: "" }, ready: false },
        ];

        let player = 0;

        
        for (const play of players) {

            const startMsg = await play.member.send(`Это Ваши поля для кораблей и для защиты! Чтобы добавить свои корабли на поля, соблюдайте нужный формат. \`${this.settings.prefix}add <корабль> <координаты> <направления>\`. Пример: \`${this.settings.prefix}add destroyer D5 down\`\n\nДоступные корабли:\ncarrier (5)\nbattleship (4)\ndestroyer (3)\nsubmarine (3)\npatrolboat (2)`);
            const hitBoard = await play.member.send(`Поле атаки:\n${this.displayBoard(play.playerHitBoard, "hit")}`);
            const dmBoard = await play.member.send(`Поле кораблей:\n${this.displayBoard(play.playerShipBoard, "ship")}`);

            play.gameMessages.start = startMsg.id;
            play.gameMessages.hits = hitBoard.id;
            play.gameMessages.boats = dmBoard.id;

            const filter = (msg: Message) => msg.author.id === play.member.id && [`${this.settings.prefix}add`, `${this.settings.prefix}attack`].includes(msg.content.split(" ")[0]);
            const dmCollector = dmBoard.channel.createMessageCollector(filter);

            play.collector = dmCollector;

            play.gameChannel = dmBoard.channel.id;

            const validBoats: Boat[] = [ { name: "carrier", length: 5, hits: 0, sunk: false }, { name: "battleship", length: 4,hits: 0, sunk: false }, { name: "destroyer", length: 3, hits: 0, sunk: false }, { name: "submarine", length: 3, hits: 0, sunk: false }, { name: "patrolboat", length: 2, hits: 0, sunk: false } ];
            const validdirections = [ "up", "down", "right", "left" ];

            dmCollector.on("collect", async (msg: Message) => {
                const argument = msg.content.slice(this.settings.prefix.length).trim().split(/ +/g);
                const cmd = argument.shift();

                if (!(<Game>players.find(plr => plr.member.id === msg.author.id)).ready) {
                    if (cmd === "add") {

                        const currPlayer = players.find(plr => plr.member.id === msg.author.id);
                        const gameChannelObject = <DMChannel>message.client.channels.cache.get(currPlayer.gameChannel);

                        const boatType = argument[0];
                        if (!boatType) return msg.channel.send("Укажите корабль, который хотите поставить.").then(m => m.delete({ timeout: 15000 }));
                        if (!validBoats.some(value => value.name === boatType.toLowerCase())) return msg.channel.send("Укажите верно корабль, который хотите поставить.").then(m => m.delete({ timeout: 15000 }));
                        if ((<Game>players.find(plyr => plyr.member.id === msg.author.id)).placedBoats.some(data => data.name === boatType.toLowerCase())) return msg.channel.send("Вы уже поставили этот корабль, попробуйте другой.").then(m => m.delete({ timeout: 15000 }));

                        const cords = argument[1];
                        if (!cords) return msg.channel.send("Введите координаты Вашего корабля. Например: `D5`").then(m => m.delete({ timeout: 15000 }));
                        const directionRegex = /[a-z]([1-9]|10)/i;
                        if (!cords.match(directionRegex)) return msg.channel.send("Введите верные координаты Вашего корабля. Например: `D5`").then(m => m.delete({ timeout: 15000 }));

                        const direction = argument[2];
                        if (!direction) return msg.channel.send("Укажите направление корабля!").then(m => m.delete({ timeout: 15000 }));
                        if (!validdirections.some(value => value === direction.toLowerCase())) return msg.channel.send(`Укажите верное направление корабля. Стороны: ${validdirections.join(", ")}`).then(m => m.delete({ timeout: 15000 }));

                        const checked = this.checkBoatPos(play.playerShipBoard, <Boat>validBoats.find(data => data.name === boatType.toLowerCase()), { letter: cords[0], number: parseInt(cords.slice(1)), cord: cords }, direction, "check");
                        if (!checked) return msg.channel.send(`Вы не можете поставить ${boatType} на ${cords} в сторону ${direction}`).then(m => m.delete({ timeout: 15000 }));

                        currPlayer.placedBoats.push(<Boat>validBoats.find(data => data.name === boatType.toLowerCase()));

                        const reRender = this.checkBoatPos((<Game>players.find(plyr => plyr.member.id === msg.author.id)).playerShipBoard, <Boat>validBoats.find(boat => boat.name === boatType.toLowerCase()), { letter: cords[0], number: parseInt(cords.slice(1)), cord: cords }, direction, "render");

                        currPlayer.playerShipBoard = reRender.board
                        gameChannelObject.messages.cache.get(currPlayer.gameMessages.boats).edit(`Доска кораблей:\n${this.displayBoard(reRender.board, "ship")}`);

                        let oldBoat = players.find(p => p.member.id === msg.author.id).placedBoats.find(b => b.name.toLowerCase() === reRender.boat.name.toLowerCase());
                        oldBoat = reRender.boat;

                        const editMe = gameChannelObject.messages.cache.get(currPlayer.gameMessages.start);
                        const regex = new RegExp(boatType.toLowerCase(), "ig");
                        editMe.edit(editMe.content.replace(regex, `~~${boatType.toLowerCase()}~~`));

                        if (currPlayer.placedBoats.length === 5) {
                            currPlayer.ready = true;
                            if (players[0].ready && players[1].ready) {
                                for (const playr of players) {
                                    const perGame = <DMChannel>message.client.channels.cache.get(playr.gameChannel);
                                    perGame.messages.cache.get(playr.gameMessages.start).edit(`Игра успешно запущена у обоих игроков! Сейчас очередь ${players[player].member.user.tag} атаковать! Используй \`${this.settings.prefix}attack <cords>\` чтобы атаковать это место!\n\nОбозначения:\n- Доска атаки:\n--- ◻️ = Пустая клетка\n--- ⚪ = Атака мимо\n--- 🔴 = Подбитый корабль\n- Доска кораблей:\n--- 🔲 = Пустая клетка\n--- 🟩 = Живой корабль\n--- 🟥 = Подбитый корабль\n--- ⚪ = Атака мимо`);
                                    playr.member.send(`${playr.member.user}`).then(m => m.delete());
                                }


                                trackingEmbed.setDescription("");
                                for (const p of players) {
                                    trackingEmbed.addField(p.member.user.tag, `Имеет ${p.placedBoats.filter(b => !b.sunk).length} кораблей!\n\n${p.placedBoats.map(b => b.sunk ? `❌ ${b.name}` : `✅ ${b.name}`).join("\n")}`);
                                }
                                trackMsg.edit(trackingEmbed);


                            } else return msg.channel.send("Похоже, что противник ещё не расставил свои корабли! Как только он закончит, Вы получите сообщение.").then(m => m.delete({ timeout: 15000 }));
                        }
                    }
                } else if (players[0].ready && players[1].ready) {
                    if (players[player].member.id === msg.author.id) {
                        if (cmd === "attack") {

                            const playerChannel = <DMChannel>message.client.channels.cache.get(players[player].gameChannel);
                            const opponentChannel = <DMChannel>message.client.channels.cache.get(players[(player + 1) % players.length].gameChannel);

                            const cords = argument[0];
                            if (!cords) return msg.channel.send("Введите координаты атаки. Пример: `D5`").then(m => m.delete({ timeout: 15000 }));
                            const directionRegex = /[a-z]([1-9]|10)/i;
                            if (!cords.match(directionRegex)) return msg.channel.send("Введите верные координаты атаки. Пример: `D5`").then(m => m.delete({ timeout: 15000 }));

                            const returnData = this.attack(players[player].playerHitBoard, players[(player + 1) % players.length].playerShipBoard, { letter: cords[0], number: parseInt(cords.slice(1)), cord: cords });
                            if (!returnData) return msg.channel.send("Вы не можете атаковать здесь!").then(m => m.delete({ timeout: 15000 }));

                            playerChannel.messages.cache.get(players[player].gameMessages.hits).edit(`Доска атаки:\n${this.displayBoard(returnData.attackBoard, "hit")}`);
                            players[player].playerHitBoard = returnData.attackBoard;
                            opponentChannel.messages.cache.get(players[(player + 1) % players.length].gameMessages.boats).edit(`Доска кораблей:\n${this.displayBoard(returnData.shipBoard, "ship")}`);
                            players[(player + 1) % 2].playerShipBoard = returnData.shipBoard;

                            const shipToHit = players[(player + 1) % players.length].placedBoats.find(s => s.name.toLowerCase() === returnData.shipName.toLowerCase());
                            if (shipToHit) {
                                shipToHit.hits++;
                                if (shipToHit.hits === shipToHit.length) {
                                    shipToHit.sunk = true;
                                    players[player].member.send(`Вы потопили ${shipToHit.name} игрока ${players[(player + 1) % players.length].member.user.tag}!`);
                                    players[(player + 1) % players.length].member.send(`Ваш ${returnData.shipName} потоплен!`);

                                    const embed = new MessageEmbed()
                                        .setTitle("Морской Бой")
                                        .setFooter(`${challenger.user.tag} vs ${opponent.user.tag}`)
                                        .setColor(this.settings.embedColor)  
                                    for (const p of players) {
                                        embed.addField(p.member.user.tag, `Имеет ${p.placedBoats.filter(b => !b.sunk).length} кораблей!\n\n${p.placedBoats.map(b => b.sunk ? `❌ ${b.name}` : `✅ ${b.name}`).join("\n")}`);
                                    }
                                    trackMsg.edit("", { embed });
                                }
                            }

                            if (this.winCondition(players[(player + 1) % players.length].placedBoats)) {
                                for (const p of players) {
                                    p.collector.stop();
                                    p.member.send(`${players[player].member.user} победил в игре!`);
                                }
                                const embed = new MessageEmbed()
                                    .setTitle("Морской Бой")
                                    .setFooter(`${challenger.user.tag} vs ${opponent.user.tag}`)
                                    .setColor(this.settings.embedColor)  
                                    .setDescription(`${players[player].member.user} победил в игре!`)
                                trackMsg.edit(`${players[0].member}, ${players[1].member}`, { embed });
                            }

                            playerChannel.messages.cache.get(players[player].gameMessages.start).edit(`Сейчас очередь  ${players[(player + 1) % players.length].member.user.tag}! Используй \`${this.settings.prefix}attack <cords>\` чтобы атаковать это место!\n\nОбозначения:\n- Доска атаки:\n--- ◻️ = Пустая клетка\n--- ⚪ = Атака мимо\n--- 🔴 = Подбитый корабль\n- Доска кораблей:\n--- 🔲 = Пустая клетка\n--- 🟩 = Живой корабль\n--- 🟥 = Подбитый корабль\n--- ⚪ = Атака мимо`);
                            opponentChannel.messages.cache.get(players[(player + 1) % players.length].gameMessages.start).edit(`It is now ${players[(player + 1) % players.length].member.user.tag}'s turn! Use \`${this.settings.prefix}attack <cords>\` чтобы атаковать это место!\n\nОбозначения:\n- Доска атаки:\n--- ◻️ = Пустая клетка\n--- ⚪ = Атака мимо\n--- 🔴 = Подбитый корабль\n- Доска кораблей:\n--- 🔲 = Пустая клетка\n--- 🟩 = Живой корабль\n--- 🟥 = Подбитый корабль\n--- ⚪ = Атака мимо`);

                            player = (player + 1) % players.length;

                            players[player].member.send(`${players[player].member.user}`).then(m => m.delete());

                        }
                    } else return msg.channel.send("Сейчас не Ваша очередь.").then(m => m.delete({ timeout: 10000 }));

                } else return msg.channel.send("Похоже, что Вы или Ваш противник ещё не расставили свои корабли! Закончите расстановку, или дождитесь соперника!").then(m => m.delete({ timeout: 10000 }));
            });
        }


        return message.channel.send("Игра идёт.");
    }

    
    private winCondition (boats: Boat[]) {
        for (const playerBoat of boats) {
            if (!playerBoat.sunk) return false;
        }
        return true;
    }

    private attack(attackBoard: Board[][], shipBoard: Board[][], spot: Cords) {
        let shipName: string = "";
        for (let i = 0; i < shipBoard.length; i++) {
            const index = shipBoard[i].findIndex(data => data.cords.cord.toLowerCase() === spot.cord.toLowerCase());
            if (shipBoard[i].find(data => data.cords.cord.toLowerCase() === spot.cord.toLowerCase())) {
                // Missed attack
                if (shipBoard[i][index].data === "0") {
                    shipBoard[i][index].data = "3";
                    attackBoard[i][index].data = "1";
                // Successful attack
                } else if (shipBoard[i][index].data === "1") {
                    shipBoard[i][index].data = "2";
                    attackBoard[i][index].data = "2";
                    shipName = shipBoard[i][index].ship;
                } else return false;

            }
        }
        return { shipBoard, attackBoard, shipName };
    }

    private checkBoatPos(board: Board[][], boat: Boat, cords: Cords, direction: string, type: "check" | "render") {
        for (let i = 0; i < board.length; i++) {
            if (board[i].find(data => data.cords.cord.toLowerCase() === cords.cord.toLowerCase())) {
                switch (direction) {
                    case "up":
                        let countUp = 0;
                        let startPosUp = i;
                        do {
                            if (type === "check") {
                                if (board[startPosUp] === undefined) return;
                                if (board[startPosUp][cords.number - 1].data === "1") return;
                                countUp++;
                                startPosUp--;
                            } else {
                                board[startPosUp][cords.number - 1].data = "1";
                                board[startPosUp][cords.number - 1].ship = boat.name;
                                countUp++;
                                startPosUp--;
                            }
                        } while (countUp < boat.length);
                    break;
                    case "down":
                        let countDown = 0;
                        let startPosDown = i;
                        do {
                            if (type === "check") {
                                if (board[startPosDown] === undefined) return;
                                if (board[startPosDown][cords.number - 1].data === "1") return;
                                countDown++
                                startPosDown++;
                            } else {
                                board[startPosDown][cords.number - 1].data = "1";
                                board[startPosDown][cords.number - 1].ship = boat.name;
                                countDown++
                                startPosDown++;
                            }
                        } while (countDown < boat.length);
                    break;
                    case "left":
                        let countLeft = 0;
                        let currIndexLeft = board[i].findIndex(data => data.cords.cord.toLowerCase() === cords.cord.toLowerCase());
                        do {
                            if (type === "check") {
                                currIndexLeft--;
                                if (board[i][currIndexLeft] === undefined) return;
                                if (board[i][currIndexLeft].data === "1") return;
                                countLeft++;
                            } else {
                                board[i][currIndexLeft].data = "1";
                                board[i][currIndexLeft].ship = boat.name;
                                currIndexLeft--;
                                countLeft++;
                            }
                        } while (countLeft < boat.length);
                    break;
                    case "right":
                        let countRight = 0;
                        let currIndexRight = board[i].findIndex(data => data.cords.cord.toLowerCase() === cords.cord.toLowerCase());
                        do {
                            if (type === "check") {
                                currIndexRight++;
                                if (board[i][currIndexRight] === undefined) return;
                                if (board[i][currIndexRight].data === "1") return;
                                countRight++;
                            } else {
                                board[i][currIndexRight].data = "1";
                                board[i][currIndexRight].ship = boat.name;
                                currIndexRight++;
                                countRight++;
                            }
                        } while (countRight < boat.length);
                    break;
                }
            }
        }
        return { boat, board };
    }
    
    private genBoard(hor: number, ver: number) {
        let whileCounter = 0;
        const boardLetter = [ { i: 0, letter: "A" }, { i: 1, letter: "B" }, { i: 2, letter: "C" }, { i: 3, letter: "D" }, { i: 4, letter: "E" }, { i: 5, letter: "F" }, { i: 6, letter: "G" }, { i: 7, letter: "H" }, { i: 8, letter: "I" }, { i: 9, letter: "J" } ];
        const doneData: { data: string, ship: string, cords: { letter: string, number: number, cord: string } }[][] = [];
        do {
            const temp: { data: string, ship: string, cords: { letter: string, number: number, cord: string } }[] = [];
            for (let i = 0; i < ver; i++) {
                const boardLttr = (<{ i: number; letter: string; }>boardLetter.find(data => data.i === whileCounter)).letter;
                temp.push({ data: "0", ship: "", cords: { letter: boardLttr, number: i + 1, cord: boardLttr + (i + 1) } });
            }
            doneData.push(temp);
            whileCounter++;
        } while (whileCounter < hor);
        return doneData;
    }

    private displayBoard(board: Board[][], type: "hit" | "ship") {
        let returnData = "";
        returnData = returnData.concat("⬛1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟\n");
        for (let i = 0; i < board.length; i++) {
            let temp = "";
            const leftEmoji = [ { i: 0, emoji: ":regional_indicator_a:" }, { i: 1, emoji: ":regional_indicator_b:" }, { i: 2, emoji: ":regional_indicator_c:" }, { i: 3, emoji: ":regional_indicator_d:" }, { i: 4, emoji: ":regional_indicator_e:" }, { i: 5, emoji: ":regional_indicator_f:" }, { i: 6, emoji: ":regional_indicator_g:" }, { i: 7, emoji: ":regional_indicator_h:" }, { i: 8, emoji: ":regional_indicator_i:" }, { i: 9, emoji: ":regional_indicator_j:" } ]
            if (type === "hit") {
                for (let j = 0; j < board[i].length; j++) {
                    // "0" is an empty space, "1" is a missed shot, "2" is a hit shot
                    temp += `${board[i][j].data === "0" ? "◻️" : board[i][j].data === "1" ? "⚪" : "🔴" }`;
                }
            } else {
                for (let j = 0; j < board[i].length; j++) {
                    // "0" is an empty space, "1" is a unhit ship piece, "2" is a hit ship piece, "3" is a missed shot from opponent
                    temp += `${board[i][j].data === "0" ? "◻️" : board[i][j].data === "1" ? "🟩" : board[i][j].data === "2" ? "🟥" : "⚪" }`;
                }
            }
            returnData += (<{ i: number, emoji: string }>leftEmoji.find(object => object.i === i)).emoji + temp + "\n"
        }
        return returnData;
    }

}

module.exports.DiscordBattleShip = DiscordBattleShip;